# yurgellab-website

Site do **Yurgel Lab**, publicado via **GitHub Pages** em
[yurgellab.com](https://yurgellab.com) (domínio registrado na GoDaddy).

## Estrutura

```
yurgellab-website/
├── index.html      # Loader: detecta desktop/mobile e redireciona
├── desktop.html    # Página desktop — CIFRADA (StatiCrypt / AES-256)
├── mobile.html     # Página mobile  — CIFRADA (StatiCrypt / AES-256)
├── CNAME           # Domínio customizado (yurgellab.com)
└── .nojekyll       # Desativa processamento Jekyll do GitHub Pages
```

## Proteção por senha

O conteúdo é **criptografado** com [StatiCrypt](https://github.com/robinmoisson/staticrypt)
(AES-256, client-side). Sem a senha correta, não há conteúdo legível nem no
código-fonte. A mesma senha vale para desktop e mobile.

### Regerar as páginas cifradas

A partir dos HTMLs originais (não versionados), com o mesmo salt em
`.staticrypt.json` (mantido apenas localmente):

```bash
npx staticrypt desktop_original.html mobile_original.html -p 'SENHA' --short --remember 30
mv encrypted/desktop.html desktop.html && mv encrypted/mobile.html mobile.html
rmdir encrypted
```

## Deploy

Push para `main` publica automaticamente no GitHub Pages
(Settings → Pages: `main` / root).

## Domínio (GoDaddy → GitHub Pages)

| Tipo  | Nome | Valor                    |
|-------|------|--------------------------|
| A     | @    | 185.199.108–111.153 (4×) |
| CNAME | www  | yurgellab.com            |
