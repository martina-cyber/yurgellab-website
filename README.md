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

A partir do HTML original responsivo `_plain_bolao.html` (não versionado),
usando o template `_staticrypt_template.html` e o mesmo salt em
`.staticrypt.json` (mantido apenas localmente). A mesma página responsiva
serve `desktop.html` e `mobile.html`:

```bash
npx staticrypt _plain_bolao.html \
  -t _staticrypt_template.html \
  -p 'SENHA' --short --remember 30 \
  -s 37d840c6b5fca59990c533e2968a1fcb \
  --template-title 'Yurgel Lab' \
  --template-instructions 'Conteúdo protegido. Digite a senha para acessar.' \
  --template-color-primary '#0C2A47' \
  --template-color-secondary '#FFFFFF' \
  --template-placeholder 'Senha' \
  --template-error 'Senha incorreta' \
  -d encrypted
cp encrypted/_plain_bolao.html desktop.html
cp encrypted/_plain_bolao.html mobile.html
rm -rf encrypted
```

> A senha **não** fica versionada. A versão institucional anterior do site está
> arquivada na branch `versao-anterior`.

## Deploy

Push para `main` publica automaticamente no GitHub Pages
(Settings → Pages: `main` / root).

## Domínio (GoDaddy → GitHub Pages)

| Tipo  | Nome | Valor                    |
|-------|------|--------------------------|
| A     | @    | 185.199.108–111.153 (4×) |
| CNAME | www  | yurgellab.com            |
