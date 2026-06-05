# yurgellab-website

Site estático do **YurgelLab**, publicado via **GitHub Pages** no domínio
[yurgellab.com](https://yurgellab.com) (registrado na GoDaddy).

## Estrutura

```
yurgellab-website/
├── index.html      # Página principal
├── styles.css      # Estilos
├── script.js       # JS mínimo
├── assets/         # Imagens e mídia
├── CNAME           # Domínio customizado (yurgellab.com)
└── .nojekyll       # Desativa processamento Jekyll do GitHub Pages
```

## Desenvolvimento local

Abra `index.html` no navegador, ou rode um servidor estático:

```bash
python3 -m http.server 8000
# acesse http://localhost:8000
```

## Deploy

O deploy é automático: qualquer `push` para a branch `main` publica o site no
GitHub Pages. Em **Settings → Pages**, a origem está configurada para
`main` / `(root)`.

## Domínio (GoDaddy → GitHub Pages)

No painel DNS da GoDaddy, configurar:

| Tipo  | Nome | Valor                  |
|-------|------|------------------------|
| A     | @    | 185.199.108.153        |
| A     | @    | 185.199.109.153        |
| A     | @    | 185.199.110.153        |
| A     | @    | 185.199.111.153        |
| CNAME | www  | martina-cyber.github.io |

Após a propagação do DNS, ativar **Enforce HTTPS** em Settings → Pages.
