# Alca RNG · Campanha dos mundos

| Versão | Arquivo |
| --- | --- |
| Jogo solo no navegador | [Baixar o HTML](https://github.com/swordssmanbalcateia5-sudo/nexus-namek/raw/refs/heads/main/jogar_namek.html) |
| Windows com suporte à presença do Discord | [Baixar para Windows](https://github.com/swordssmanbalcateia5-sudo/nexus-namek/raw/refs/heads/main/nexus-windows-discord.zip) |
| Cloudflare Pages e API da Comunidade (build 57) | [Arquivos da build em `public/`](public/) |
| Pacote histórico do Cloudflare (build 52) | [Baixar o ZIP da build 52](https://github.com/swordssmanbalcateia5-sudo/nexus-namek/raw/refs/heads/main/nexus-cloudflare.zip) |
| Arquivo histórico do projeto e testes | [Baixar o projeto](https://github.com/swordssmanbalcateia5-sudo/nexus-namek/raw/refs/heads/main/nexus_namek_codigo.zip) |

As artes complementares estão em [nexus-arte-reserva.zip](https://github.com/swordssmanbalcateia5-sudo/nexus-namek/raw/refs/heads/main/nexus-arte-reserva.zip). Para restaurar a pasta de arte completa, extraia esse ZIP no mesmo local do ZIP do código.

## Pacote da build atual

A pasta `public/` contém a build 57 para o Cloudflare Pages, incluindo o Worker e os assets. Para gerar o pacote a partir da raiz do repositório, compacte o conteúdo dessa pasta com `index.html` e `_worker.js` na raiz do ZIP.

```sh
(cd public && zip -qr ../nexus-cloudflare-build57.zip .)
```

No projeto do Cloudflare Pages, mantenha `NEXUS_DB` vinculado ao banco D1 da campanha. A versão Windows inclui instruções para configurar o Application ID e o ícone no Discord.

[Guia do jogo e do servidor](LEIA-ME.md)
