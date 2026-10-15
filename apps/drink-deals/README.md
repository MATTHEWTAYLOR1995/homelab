# Can Finder (Drink Deals)

A lightweight homelab app that checks public product pages for diet/zero-sugar multipacks and shows current pack prices, member prices when exposed, detected multibuys, and price per can. It scans Amazon UK, Asda, Iceland, Sainsbury's, Waitrose, and Tesco.

## How it works

- The app searches a small set of drink queries on each retailer every 12 hours. Use **Scan now** to request an additional scan.
- Product data is read from public structured product data (JSON-LD) returned by each page. The scanner does not sign in, submit a postcode, or bypass anti-bot controls.
- Prices are stored in SQLite on the `drink-deals-data` persistent volume claim, so they survive pod restarts.
- Member prices are shown separately when a retailer exposes them publicly. Personalised or account-only discounts cannot be inferred from a public page.
- The app reports a retailer as unavailable when it blocks the request or does not return usable product data. Retailer sites change, so this is a best-effort personal tool rather than a guaranteed price feed.

Public grocery pricing can depend on postcode, delivery slot, store, stock and loyalty account. Verify the price and offer conditions at the retailer before buying. A discovered product's pack count is inferred from its name and may be unknown if the product title does not state it clearly.

## Local run

```powershell
docker compose up --build
```

Open <http://localhost:5000>. The SQLite database is created in `./data`.

## Kubernetes

Argo CD deploys this app from `apps/drink-deals` into the `drink-deals` namespace. The first-time Argo CD registration step is:

```powershell
kubectl apply -f .\argocd\drink-deals.yaml
```

The app is available at <http://deals.localhost:8080> from the cluster PC and at <http://192.168.1.109:3005> from another device on the main home LAN after the LAN proxy configuration is deployed. It needs no credentials or Kubernetes API access.
