Download KES CRD:
```
curl -o kes-crd.yaml https://raw.githubusercontent.com/external-secrets/kubernetes-external-secrets/master/charts/kubernetes-external-secrets/crds/kubernetes-client.io_externalsecrets_crd.yaml
```

Get KES external secrets:

```
kubectl get es -oyaml --all-namespaces > secrets.yaml
```
