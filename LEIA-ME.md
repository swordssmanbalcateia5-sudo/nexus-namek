# Nexus · Campanha dos mundos

## Testar com duas contas

1. Extraia o ZIP e abra um terminal na pasta nexus-namek com Node.js 24.
2. Execute `npm start` e abra `http://localhost:4173`.
3. Em **Comunidade**, crie um perfil e guarde o código de acesso privado mostrado em **Meu perfil**. Abra outra janela privativa ou outro navegador no mesmo endereço para criar a segunda conta.
4. Na segunda conta, anote o código de amigo. Na primeira, abra **Amigos**, envie o convite e aceite-o na segunda conta.
5. Envie um presente. Atualize **Amigos** no destinatário para ver o recebimento. O saldo se atualiza na sincronização do jogo.

Duas pessoas em computadores diferentes precisam acessar a mesma instância. Para um teste na mesma rede, no PowerShell execute `$env:NEXUS_HOST="0.0.0.0"; npm start` e use o IP de rede da máquina que iniciou o servidor. Em uma hospedagem Node, use HTTPS, configure `PORT` e `NEXUS_HOST` e aponte `NEXUS_DB` para um volume persistente. No Cloudflare Pages, publique o conteúdo de nexus-cloudflare.zip e vincule um banco D1 à variável NEXUS_DB em produção. Após criar ou alterar o vínculo, publique novamente. O Worker incluído atende a API da Comunidade.

O banco padrão fica em `data/nexus.sqlite`. O ouro, o inventário, os encontros, os upgrades, os perfis e as amizades online ficam no servidor. Não compartilhe o banco ou os códigos de acesso privados. O código de amigo pode ser compartilhado. O tempo de jogo conta os intervalos de interação e sincronização enquanto o jogo está visível. Encontros AFK concluídos entram na contagem de encontros.

## Comunidade

- **Raridade** ordena os personagens com chance de obtenção registrada. `1/100M` significa uma chance em cem milhões. O valor completo aparece ao passar o cursor sobre a abreviação.
- **Força** soma PV, Ataque, Magia, Defesa, Resistência e Velocidade dos quatro personagens com maior soma no inventário. Nível, Traits e Shiny entram na conta. Posição na formação e bônus de líder não entram.
- **Perfil** tem tempo de jogo ativo, encontros concluídos, Time atual e Showcase automático com até cinco recrutados de maior raridade. O dono pode escolher o cenário de fundo, enviar uma foto para o avatar e escolher a borda.
- **Amigos** permite convidar, aceitar, remover e enviar um presente por amigo a cada ciclo. Cada presente dá 10 de ouro, creditados de imediato. O histórico fica em **Presentes recebidos**.
- **Horário global** usa o relógio do servidor. Cada ciclo começa ao meio-dia no fuso `America/Sao_Paulo`. Outros modos podem usar a mesma função `dailyCycle`.

## Jogo solo e campanha

Para jogar solo, abra `jogar_namek.html` no navegador. O progresso solo é local e fica separado da conta online. Para atualizar, feche o jogo e substitua o HTML mantendo o nome, a pasta e o perfil do navegador. Em **Configurações → Progresso da campanha → Exportar backup**, você pode baixar a campanha em JSON. Para mudar de arquivo, navegador ou dispositivo, abra a nova build e escolha **Importar backup**. Se o save antigo só aparecer na versão anterior, coloque a build atualizada exatamente no caminho daquela versão para acessar o mesmo armazenamento.

A equipe já começa explorando ao abrir o jogo ou criar a conta online. O retorno contabiliza até 12 horas de ausência e a exploração continua. **Parar exploração** conclui a luta atual e suspende os próximos encontros, mesmo após fechar o jogo. Para retomar, clique em **Explorar** na própria arena (ou marque **Exploração automática** em **Configurações**).

Cada mundo tem três áreas, um encontro de elite e um chefe. Por padrão, a equipe passa para uma área de nível mais alto assim que pode. Escolher uma rota manualmente fixa essa área. Após 12 vitórias na área final, a progressão automática desafia o chefe e viaja após vencer. A escolha manual de mundo ou área desliga a progressão automática. A primeira vitória libera o próximo destino no menu lateral **Mundos** e amplia o limite de nível em dez, até o nível 100. O progresso de cada mundo fica salvo ao viajar.

A campanha passa por Namek, Arlong Park, Exames Chūnin, Soul Society, Jujutsu Kaisen, Black Clover, Nanatsu no Taizai, JoJo, Hunter × Hunter e One Punch Man. Os mundos usam sprites provisórios. O elenco recrutável é compartilhado entre os mundos, com preferência pelo universo local quando há candidatos no tier sorteado.

Na **Formação**, arraste os personagens no campo, use **Auto-formação** (por maior força, equipe equilibrada ou vantagem contra a área atual), escolha presets rápidos de posicionamento, defina o líder ou troque um titular por um reserva. Com o teclado, use Tab para focar um marcador, as setas para movê-lo e Enter para abrir a ficha. Na **Coleção**, filtre por busca, função, raridade, Shiny ou Trait, ordene por força/nível/raridade e venda reservas quando desejar. Clique no personagem na arena, na coleção ou na formação para consultar seus atributos.

As opções de animações e números de dano ficam neste dispositivo. Os upgrades de ritmo, sorte, ouro, XP compartilhada, rastreio de raros, treino e enfermaria ficam no progresso da campanha.

## Verificação e desenvolvimento

`npm test` roda os testes de jogo e de Comunidade. `npm run standalone -- jogar_namek.html` gera o HTML solo. O projeto usa apenas APIs do Node.js e do navegador.

- `public/engine.js` resolve o combate e o replay.
- `public/game.js` cuida de campanha, elenco, recompensas e ações válidas.
- `public/community-rules.js` contém o relógio diário, as opções de perfil e os valores iniciais de presentes.
- `community-store.mjs` e `dev.mjs` implementam a persistência e a API online.

## Arena das bolas

Abra **Arena → Começar duelo** para treinar com sua formação contra a equipe de Namek. No servidor, abra o perfil de outro jogador em Comunidade e escolha **Desafiar na Arena** para enfrentar uma cópia da formação atual com seu bônus de líder. A exploração continua. Os duelos são amistosos e não concedem recompensas. Sair da aba pausa o duelo. Fechar o jogo encerra a partida.

## Comparação de força e seriais

Na Coleção, filtre a raridade e ordene por **Força no nível 100**. O potencial soma os seis atributos no nível 100, incluindo os modificadores da cópia. A autoformação usa essa projeção e também considera o bônus do líder e o critério escolhido.

Na Comunidade, cada personagem tem uma sequência global para a versão normal e outra para a shiny. Vendas não liberam números. Na migração, as contas antigas recebem faixas por ordem de criação, mantendo a ordem de cada jogador dentro da faixa. O modo solo usa seriais locais.

## Torre Infinita

Após derrotar Boros no Mundo 10, a aba **Torre** libera combates 4×2 (andares 1–4), 4×3 (andares 5–9) e 4×4 (andares 10+) contra esquadrões determinísticos com bônus de líder. A primeira vitória em cada andar concede ouro (com bônus marco a cada 5 andares) e registra seu maior andar no ranking **Torre** da Comunidade.
