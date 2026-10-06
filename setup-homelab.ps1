<#
  Creates the homelab repo layout (cafcnews app, cloudflared, ArgoCD Applications).

  Run it from inside your homelab folder, for example:
    cd C:\Users\matth\OneDrive\Documents\homelab
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    .\setup-homelab.ps1 -Owner MATTHEWTAYLOR1995 -Domain localhost -Force

  Existing files are skipped unless you pass -Force.
#>
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [Parameter(Mandatory = $true)][string]$Domain,
  [string]$Subdomain = "charlton",
  [string]$ImageName = "cafcnews",
  [int]$Port = 3000,
  [string]$Tag = "REPLACE_WITH_A_COMMIT_SHA",
  [string]$CloudflaredTag = "latest",
  [switch]$Force
)

$Owner = $Owner.ToLower()
$Fqdn = "$Subdomain.$Domain"

function Write-Manifest {
  param([string]$Path, [string]$Content)

  $full = Join-Path (Get-Location).Path $Path
  if ((Test-Path $full) -and -not $Force) {
    Write-Host "skip    $Path (already exists, use -Force to overwrite)" -ForegroundColor Yellow
    return
  }

  $text = $Content.Replace("__OWNER__", $Owner).Replace("__FQDN__", $Fqdn).Replace("__TAG__", $Tag).Replace("__CFTAG__", $CloudflaredTag).Replace("__IMAGE__", $ImageName).Replace("__PORT__", [string]$Port)
  $text = $text.Replace("`r`n", "`n").TrimStart("`n")

  New-Item -ItemType Directory -Force -Path (Split-Path $full -Parent) | Out-Null
  [IO.File]::WriteAllText($full, $text, (New-Object Text.UTF8Encoding $false))
  Write-Host "created $Path" -ForegroundColor Green
}

# ---------- apps/charlton ----------

Write-Manifest "apps/charlton/kustomization.yaml" @'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: charlton
resources:
  - deployment.yaml
  - service.yaml
  - ingress.yaml
images:
  - name: ghcr.io/__OWNER__/__IMAGE__
    newTag: __TAG__
'@

Write-Manifest "apps/charlton/deployment.yaml" @'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: charlton
spec:
  # One replica on purpose: the app writes data/transfers-rumours.json to its own
  # disk, so two pods would each hold a different copy. Those writes are lost when
  # the pod restarts or a new image rolls out (the JSON in git is the source of truth).
  replicas: 1
  selector:
    matchLabels:
      app: charlton
  template:
    metadata:
      labels:
        app: charlton
    spec:
      containers:
        - name: web
          image: ghcr.io/__OWNER__/__IMAGE__
          ports:
            - containerPort: __PORT__
          env:
            - name: PORT
              value: "__PORT__"
          readinessProbe:
            httpGet:
              path: /
              port: __PORT__
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: __PORT__
            initialDelaySeconds: 20
            periodSeconds: 20
            timeoutSeconds: 5
          resources:
            requests:
              cpu: 25m
              memory: 128Mi
            limits:
              # headroom for the headless Chromium (Puppeteer) fallback
              memory: 768Mi
'@

Write-Manifest "apps/charlton/service.yaml" @'
apiVersion: v1
kind: Service
metadata:
  name: charlton
spec:
  selector:
    app: charlton
  ports:
    - port: 80
      targetPort: __PORT__
'@

Write-Manifest "apps/charlton/ingress.yaml" @'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: charlton
spec:
  ingressClassName: traefik
  rules:
    - host: __FQDN__
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: charlton
                port:
                  number: 80
'@

# ---------- platform/cloudflared (only needed once you have a domain) ----------

Write-Manifest "platform/cloudflared/kustomization.yaml" @'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: cloudflared
resources:
  - deployment.yaml
'@

Write-Manifest "platform/cloudflared/deployment.yaml" @'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cloudflared
  template:
    metadata:
      labels:
        app: cloudflared
    spec:
      containers:
        - name: cloudflared
          image: cloudflare/cloudflared:__CFTAG__   # pin to a specific version once it works
          args: ["tunnel", "--no-autoupdate", "--metrics", "0.0.0.0:2000", "run"]
          env:
            - name: TUNNEL_TOKEN
              valueFrom:
                secretKeyRef:
                  name: tunnel-token
                  key: token
          livenessProbe:
            httpGet:
              path: /ready
              port: 2000
            initialDelaySeconds: 10
            periodSeconds: 10
'@

# ---------- argocd Applications ----------

Write-Manifest "argocd/charlton.yaml" @'
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: charlton
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/__OWNER__/homelab.git
    targetRevision: main
    path: apps/charlton
  destination:
    server: https://kubernetes.default.svc
    namespace: charlton
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
'@

Write-Manifest "argocd/cloudflared.yaml" @'
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cloudflared
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/__OWNER__/homelab.git
    targetRevision: main
    path: platform/cloudflared
  destination:
    server: https://kubernetes.default.svc
    namespace: cloudflared
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
'@

# ---------- repo hygiene ----------

Write-Manifest ".gitignore" @'
# never commit plain secrets
*.secret.yaml
*-secret.yaml
.env
'@

Write-Host ""
Write-Host "Image used by the manifests: ghcr.io/$Owner/$ImageName (port $Port, host $Fqdn)" -ForegroundColor Cyan
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Set newTag in apps/charlton/kustomization.yaml to a real commit SHA (or rerun with -Tag <sha> -Force)."
Write-Host "  2. git add . ; git commit -m 'Add charlton app' ; git push"
Write-Host "  3. kubectl apply -f argocd/charlton.yaml   (skip argocd/cloudflared.yaml until you have a domain)"
