# Migração do Cloudflare para uma VM

O servidor da VM (`server/server.mjs`) roda o mesmo `public/_worker.js` do Cloudflare. A diferença é que o D1 vira um arquivo SQLite local (`server/d1-sqlite.mjs`). A API, as regras e o banco mantêm o mesmo formato, então só os dados mudam de lugar.

Sem o limite de CPU do Workers, a recuperação offline usa lotes de 300 encontros (`RECOVERY_BATCH`). Num teste local, 12 h de ausência levaram 4 requisições e menos de 1 s. Antes eram 87 requisições e cerca de 23 s.

## 1. Criar a VM

Os dois provedores têm região em São Paulo, perto dos jogadores.

| | Oracle Cloud | AWS |
|---|---|---|
| Opção | Ampere A1 (ARM), *Always Free*: até 4 OCPU e 24 GB | Lightsail 2 GB, ou EC2 `t4g.small` |
| Custo | Gratuito | ~US$ 10–15/mês |
| Cuidados | Nem sempre há capacidade A1 em `sa-saopaulo-1`. Contas Free podem ter instâncias ociosas recuperadas: passe a conta para *Pay As You Go* (continua sem cobrança no limite Free). Abra as portas 80/443 na *Security List* **e** no `iptables` da imagem Ubuntu. | Mais simples e previsível. Libere 80/443 no firewall do Lightsail ou no Security Group. |

Use Ubuntu 24.04 LTS. 1 vCPU e 1–2 GB de RAM bastam para começar.

## 2. Preparar o servidor

```sh
# Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs caddy git
sudo useradd --system --home /opt/alca-rng --shell /usr/sbin/nologin alca
sudo mkdir -p /var/lib/alca-rng && sudo chown alca: /var/lib/alca-rng
sudo git clone https://github.com/swordssmanbalcateia5-sudo/nexus-namek /opt/alca-rng
sudo cp /opt/alca-rng/deploy/alca-rng.env.example /etc/alca-rng.env && sudo chmod 600 /etc/alca-rng.env
sudo nano /etc/alca-rng.env            # domínio, OAuth etc.
sudo cp /opt/alca-rng/deploy/alca-rng.service /etc/systemd/system/
sudo cp /opt/alca-rng/deploy/Caddyfile /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile
```

## 3. Copiar os dados do D1

Coloque o jogo em manutenção ou faça a cópia num horário vazio: o que for gravado no D1 depois do export se perde.

```sh
# Na sua máquina, com o wrangler logado na conta do Cloudflare:
npx wrangler d1 export NOME_DO_BANCO --remote --output=nexus.sql
scp nexus.sql usuario@IP_DA_VM:/tmp/
# Na VM:
sudo -u alca node /opt/alca-rng/deploy/import-d1.mjs /tmp/nexus.sql /var/lib/alca-rng/nexus.sqlite
```

O script mostra quantos jogadores vieram e roda o teste de integridade.

## 4. Subir e trocar o DNS

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now alca-rng caddy
curl -s https://jogo.exemplo.com.br/api/health
```

**Mantenha o mesmo domínio.** O token de acesso de cada jogador fica no `localStorage`, que é separado por domínio. Se o jogo está num domínio próprio, basta apontar o DNS (registro A) para o IP da VM. Se está em `*.pages.dev`, os jogadores vão precisar entrar de novo, com o código de acesso privado ou com Google/Discord. Avise antes.

Se usa OAuth, cadastre as URLs de retorno do novo domínio nos consoles do Google e do Discord.

## 5. Backups

```sh
sudo chmod +x /opt/alca-rng/deploy/backup.sh
echo '15 * * * * alca /opt/alca-rng/deploy/backup.sh' | sudo tee /etc/cron.d/alca-rng
```

Copie os backups para fora da VM (S3, OCI Object Storage), porque a VM agora é o único lugar onde os dados ficam. Para backup contínuo, considere o [Litestream](https://litestream.io).

## Atualizar o jogo

```sh
cd /opt/alca-rng && sudo git pull && sudo systemctl restart alca-rng
```

## Rodar localmente

```sh
npm start        # http://localhost:4173, banco em data/nexus.sqlite
npm test
```
