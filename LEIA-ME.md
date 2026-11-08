# Nunnez — Rolê com Nunnez

App para dividir os gastos de viagem entre amigos de um jeito justo, com acerto por Pix.
Funciona no celular como app (PWA), inclusive sem internet: os gastos ficam guardados e sobem para a planilha quando o sinal volta.

## O que ele faz

- **Divisão justa:** cerveja só para quem bebe, churrasco só para quem come carne, hospedagem por noite dormida, comida só para quem estava no dia, casal contando como 2 e criança como 0,5.
- **Carro:** aluguel, combustível, pedágio e estacionamento divididos só entre quem foi em cada carro. Carro de um amigo pode ter um valor de desgaste por km.
- **Caução:** só entra na conta o que ficar retido.
- **Pedágio por tag:** dá para lançar como "pendente" até a fatura chegar.
- **Moeda estrangeira:** busca a cotação do dia e soma o IOF do cartão (3,5%).
- **Acerto:** calcula o menor número de Pix e gera o QR Code / copia e cola de cada um.
- **Plano:** estimativa antes da viagem (combustível, hospedagem, comida…) × o que já foi gasto.
- **Resumo:** total, dia mais caro, para onde foi o dinheiro e quem mais pagou, com botão para mandar no grupo.
- **Acesso com senha:** quem cria a viagem é o organizador. Ele cadastra cada pessoa e cria uma senha inicial; no primeiro acesso a pessoa cria a dela. O organizador pode ter ajudantes (marcar "também é organizador").
- **Voos:** cada um informa de onde sai, abre o Google Voos já com a busca pronta e registra a passagem (companhia, voo, horários). O organizador confirma. Lista de chegadas para combinar quem busca quem.
- **E-mails automáticos:** o organizador recebe aviso quando alguém registra a passagem; quem ainda não comprou recebe lembrete toda segunda e a 60, 45, 30, 21, 14, 7 e 3 dias da viagem.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html`, `app.js`, `calc.js` | O app (telas, regras de divisão, Pix) |
| `config.js` | **Único arquivo para editar:** nome do app e endereço da planilha |
| `sw.js`, `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`, `favicon.png`, `logo.jpg` | Funciona offline, ícones e logo |
| `marca\` | Imagem original do logo (alta resolução). Não publicar: o site usa as versões recortadas. |
| `planilha\Code.gs` | "Servidor" que roda dentro da planilha. **Não publicar no GitHub.** |

Sem a planilha ligada (`API_URL` vazio), o app roda em **modo demonstração**: os dados ficam só no aparelho.

## Como ligar (uma vez só)

### 1. Planilha (conta nunnezfreela@gmail.com)
1. No Google Drive, crie a pasta **Nunnez** e, dentro dela, uma planilha em branco chamada **Nunnez - Viagens**.
2. Na planilha: **Extensões > Apps Script**. Apague o que aparecer e cole todo o conteúdo de `planilha\Code.gs`. Salve.
3. Volte para a planilha e recarregue a página. Aparece o menu **Nunnez**: clique em **Preparar abas** e depois em **Autorizar fotos no Drive** (o Google pede permissão: Avançado > Acessar > Permitir).

### 2. Publicar o "servidor"
1. No Apps Script: **Implantar > Nova implantação > Tipo: App da Web**.
2. Executar como: **Eu**. Quem pode acessar: **Qualquer pessoa**.
3. Copie o endereço que termina em `/exec` e cole em `config.js`, no `API_URL`.
4. Quando mudar o Code.gs depois: **Gerenciar implantações > lápis > Nova versão** (assim o endereço não muda).
5. Para os lembretes de passagem: na planilha, menu **Nunnez > Ativar lembretes de passagem por e-mail** (uma vez só; o Google pede permissão de e-mail).

Teste local do Code.gs (sem planilha de verdade): `planilha\teste-harness.js` (ver o comentário no topo). Não publicar.

### 3. Site (GitHub Pages)
Publicar num repositório próprio, separado do GYN Pedidos. Todos os arquivos da raiz, **menos** as pastas `planilha` e `marca`.
A cada mudança no app, suba o número do `CACHE` em `sw.js` (`racha-v1`, `racha-v2`…).

## Planilha

Abas: **Viagens** (com o código secreto de cada viagem), **Pessoas** (a coluna Senha guarda só um código embaralhado, nunca a senha), **Carros**, **Gastos**, **Acertos** e **Passagens**. Cada linha tem a coluna Viagem, então várias viagens convivem na mesma planilha.
Fotos dos cupons vão para a pasta **Fotos Nunnez**, ao lado da planilha.
Dá para conferir e corrigir na planilha, mas não mude os nomes das colunas.
