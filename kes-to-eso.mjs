#!/usr/bin/env node
import yaml from 'js-yaml';
import fs from 'fs';
import meow from 'meow';
import globby from 'globby';
import path from 'path';
import mkdirp from 'mkdirp';

const cli = meow(
  `
	Usage
	  $ kes-to-eso

	Options
    --input, -i - Path to KES secrets, can be set multiple times
    --refreshInterval - Refresh interval to set in converted (default: 1h)
    --cluster boolean - create ClustSecretStore instead of SecretStore (default: false)
    --out - output path

	Examples
	  $ kes-to-eso --input ./external-secrets/**.yaml
`,
  {
    importMeta: import.meta,
    flags: {
      input: {
        type: 'string',
        alias: 'i',
        default: ['./kes-secrets.yaml'],
        isMultiple: true,
      },
      out: {
        type: 'string',
        alias: 'o',
        default: './converted',
      },
      refreshInterval: {
        type: 'string',
        default: '1h',
      },
      cluster: {
        type: 'boolean',
        default: false,
      },
    },
  }
);

const fail = (item, field, value) => {
  if (!value) {
    if (!item[field]) {
      console.error('Expected', item.metadata.name, 'to have field:', field);
      return true;
    }
    return false;
  }
  if (item[field] !== value) {
    console.error(
      'Expected',
      item.metadata.name,
      'to have field:',
      field,
      'with value:',
      value
    );
    return true;
  }
  return false;
};

const cleanKesItem = (item) => {
  const copy = JSON.parse(JSON.stringify(item));
  delete copy.metadata.creationTimestamp;
  delete copy.metadata.generation;
  delete copy.metadata.resourceVersion;
  delete copy.metadata.uid;
  delete copy.metadata.selfLink;
  delete copy.metadata.annotations?.[
    'kubectl.kubernetes.io/last-applied-configuration'
  ];
  delete copy.status;

  return copy;
};

// ESO:
//   key: provider-key
//   version: provider-key-version
//   property: provider-key-property
const createRemoteRef = (dataItem) => {
  const remoteRef = {
    key: dataItem.key,
  };

  const version =
    dataItem.version || dataItem.versionId || dataItem.versionStage;
  if (version) {
    remoteRef.version = version;
  }

  if (dataItem.property) {
    remoteRef.property = dataItem.property;
  }

  return remoteRef;
};

const convertData = (kesData) =>
  kesData.map((dataItem) => ({
    secretKey: dataItem.name,
    remoteRef: createRemoteRef(dataItem),
  }));

// ESO:
// dataFrom:
// - key: provider-key
//   version: provider-key-version
//   property: provider-key-property
const convertDataFrom = (kesDataFrom) =>
  kesDataFrom.map((dataFromItem) => createRemoteRef({ key: dataFromItem }));

(async () => {
  const { input, out, refreshInterval, cluster } = cli.flags;
  const paths = await globby(input);

  const esoSecrets = paths
    .flatMap((path) => {
      const documents = yaml.loadAll(fs.readFileSync(path, 'utf-8'));

      return documents.flatMap((parsed) => {
        if (parsed.items) {
          return parsed.items;
        }

        return parsed;
      });
    })
    .filter(
      (item) =>
        !(
          fail(item, 'apiVersion', 'kubernetes-client.io/v1') ||
          fail(item, 'kind', 'ExternalSecret') ||
          fail(item, 'spec')
        )
    )
    .map(cleanKesItem)
    .map((kes) => {
      const eso = {
        apiVersion: 'external-secrets.io/v1alpha1',
        kind: 'ExternalSecret',
        metadata: kes.metadata,
        spec: {
          refreshInterval,

          secretStoreRef: {
            name: kes.spec.backendType,
            kind: cluster ? 'ClusterSecretStore' : 'SecretStore',
          },
        },
      };

      if (kes.spec.template) {
        eso.spec.target = {
          template: kes.spec.template,
        };
      }

      if (kes.spec.data) {
        eso.spec.data = convertData(kes.spec.data);
      }

      if (kes.spec.dataFrom) {
        eso.spec.dataFrom = convertDataFrom(kes.spec.dataFrom);
      }

      return eso;
    });

  if (esoSecrets.length === 0) {
    console.warn('No convertable ExternalSecrets found');
    process.exit(1);
  }

  esoSecrets.forEach((esoSecret) => {
    const namespace = esoSecret.metadata.namespace || 'default';
    const output = yaml.dump(esoSecret);
    const outputPath = path.resolve(
      out,
      namespace,
      `${esoSecret.metadata.name}.yaml`
    );
    console.log('Writing to', outputPath);
    mkdirp.sync(path.dirname(outputPath));
    fs.writeFileSync(outputPath, output);
  });
})();
