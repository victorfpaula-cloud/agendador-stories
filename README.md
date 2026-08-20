# Agendador de Stories

Painel próprio pra agendar Stories do Instagram em horários recorrentes, toda semana,
pras contas que você administra (alternativa ao Metricool). Você conecta a conta do
Facebook/Instagram de cada cliente, define dia da semana + horário + a arte, e o sistema
publica sozinho, sempre naquele horário, todo santo dia da semana escolhido.

## Como funciona, por baixo dos panos

- **Site (Next.js)**: onde você conecta contas e monta a grade semanal de cada uma.
- **Banco + storage de mídia (Supabase)**: guarda contas conectadas, horários e as artes enviadas.
- **Motor de publicação**: uma rotina que roda a cada 5 minutos, olha "que horas são em
  São Paulo, que dia da semana é hoje" e publica qualquer horário que bateu, usando a
  API do Instagram (Graph API do Meta).

Isso significa que você **precisa** de duas contas gratuitas (Supabase e Vercel) e de um
app criado no Meta for Developers — é o mesmo caminho que qualquer ferramenta desse tipo
(Metricool incluso) percorre por trás.

> **Nota sobre este pacote**: o ambiente onde eu escrevi este código não tinha acesso
> à internet pra baixar os pacotes do `npm` e rodar `npm install` / `npm run build` aqui
> antes de te entregar — então o código não foi testado rodando de fato. Ele segue os
> padrões corretos e bem estabelecidos do Next.js 14 + Supabase, mas o primeiro passo,
> antes de mexer em qualquer coisa de Meta/Supabase, é rodar `npm install` e `npm run dev`
> na sua máquina (ou direto no Vercel) e me mandar o erro se algo não subir — eu conserto.

---

## Passo 1 — Criar o projeto no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e um novo projeto (plano Free).
2. Vá em **SQL Editor → New query**, cole o conteúdo de `supabase/schema.sql` e rode.
   Isso cria as tabelas e o bucket de mídia.
3. Vá em **Authentication → Users → Add user** e crie o SEU usuário admin (e-mail + senha).
   É só com esse login que o painel abre.
4. Vá em **Project Settings → API** e anote:
   - `Project URL` → vai virar `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → vai virar `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role key` → vai virar `SUPABASE_SERVICE_ROLE_KEY` (⚠️ nunca exponha essa
     chave no navegador — ela só é usada no código que roda no servidor)

## Passo 2 — Criar o app no Meta for Developers

1. Entre em [developers.facebook.com](https://developers.facebook.com/apps) com a conta
   do Facebook que já administra as páginas dos seus clientes.
2. Crie um app do tipo **Empresa (Business)**.
3. Adicione o produto **Facebook Login for Business** (ou "Instagram" conforme a tela do
   Meta apresentar — a nomenclatura muda de vez em quando).
4. Em **Configurações do Facebook Login → Valid OAuth Redirect URIs**, adicione:
   `https://SEU-DOMINIO.vercel.app/api/auth/facebook/callback`
   (troque pelo domínio real depois do deploy — dá pra editar isso depois também).
5. Garanta que o app está vinculado ao mesmo **Business Portfolio** onde as Páginas do
   Dona Baunilha, Bebedor Shopping e Único Sushi Bar já estão. Como você já é admin
   dessas contas, isso te dá **Acesso Padrão (Standard Access)** — ou seja, **não**
   precisa passar pela Revisão de App nem pela Verificação de Negócio do Meta pra
   publicar nelas. Isso só seria necessário se um dia a ferramenta publicasse em contas
   de gente de fora do seu Business Portfolio.
6. Em **Configurações básicas do app**, pegue o **App ID** e o **App Secret**.

## Passo 3 — Variáveis de ambiente

Copie `.env.example` pra `.env.local` (rodando localmente) e depois cadastre as mesmas
variáveis no Vercel (Project Settings → Environment Variables) quando for fazer o deploy:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
FACEBOOK_REDIRECT_URI=https://SEU-DOMINIO.vercel.app/api/auth/facebook/callback
NEXT_PUBLIC_SITE_URL=https://SEU-DOMINIO.vercel.app
CRON_SECRET=uma-string-aleatoria-bem-longa
```

## Passo 4 — Rodar localmente (recomendado antes do deploy)

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`, entre com o usuário admin criado no Passo 1. O botão
"Adicionar conta" só funciona depois do deploy (porque o Facebook exige um domínio
público no redirect), mas o login e a navegação já dá pra testar aqui.

## Passo 5 — Deploy no Vercel

1. Suba este código pra um repositório no GitHub.
2. Em [vercel.com](https://vercel.com), importe o repositório.
3. Cole as variáveis de ambiente do Passo 3.
4. Deploy. Anote a URL final (ex: `agendador-stories.vercel.app`) e atualize, se precisar,
   o `FACEBOOK_REDIRECT_URI` / `NEXT_PUBLIC_SITE_URL` tanto no Vercel quanto no app do Meta.

## Passo 6 — Ligar o motor de publicação (cron)

Escolha **uma** das duas opções (não precisa das duas):

**Opção A — Supabase Cron (recomendada)**
No SQL Editor do Supabase, edite `supabase/cron.sql` trocando a URL e o `CRON_SECRET`
pelos valores reais, e rode o script. Ative as extensões `pg_cron` e `pg_net` em
**Database → Extensions** se ainda não estiverem ativas.

**Opção B — GitHub Actions**
Em **Settings → Secrets and variables → Actions** do repositório, crie os secrets
`SITE_URL` e `CRON_SECRET`. O workflow em `.github/workflows/publish-cron.yml` já
roda a cada 5 minutos sozinho.

## Passo 7 — Usar

1. Acesse o site, faça login.
2. Clique em **Adicionar conta** → entre com o Facebook → escolha a Página do cliente
   (ex: Único Sushi Bar) → Conectar.
3. Clique na conta → aparecem os 7 dias da semana, cada um com 5 campos de horário +
   mídia (e um botão "+ Adicionar horário" pra colocar mais). Escolha o horário, suba a
   arte, salve. Repita pros outros dias e pras outras contas.
4. Pronto — toda semana, naquele dia e horário, o sistema publica sozinho.

Pra reconectar uma conta cujo token expirou (acontece a cada ~60 dias, ou se alguma
publicação começar a falhar por erro de permissão), é só clicar em **Adicionar conta**
de novo (ou no botão **Reconectar** dentro da própria conta) e escolher a mesma Página —
ele atualiza a conexão sem duplicar nada.

---

## Limitações e decisões conscientes deste MVP

- **Um usuário só (você)**. Não tem sistema de múltiplos logins/permissões — é um painel
  interno da sua agência, como você pediu.
- **A arte precisa vir pronta** (9:16, já com texto/stickers se quiser) — a API do
  Instagram publica a imagem/vídeo exatamente como está, sem aplicar os efeitos do
  editor nativo do app do Instagram.
- **Vídeos** passam por processamento no servidor do Meta antes de publicar; o sistema
  espera até 1 minuto por isso antes de desistir e registrar erro.
- **Tolerância de horário**: se o cron atrasar um pouco (o que pode acontecer com
  GitHub Actions em horários de pico), o sistema ainda publica um horário até 15 minutos
  depois do previsto, e nunca publica o mesmo horário duas vezes no mesmo dia.
- **Segurança**: todas as tabelas têm Row Level Security ativado sem nenhuma policy
  pública — só o backend, usando a `service_role key` (que fica só no servidor, nunca no
  navegador), consegue ler ou escrever. O bucket de mídia é público pra LEITURA (a API do
  Instagram precisa baixar o arquivo por URL), mas só o backend consegue enviar arquivos
  pra ele.

## Se algo der erro

- **"Erro ao conectar com o Facebook"** logo depois de escolher a página: geralmente é
  `FACEBOOK_REDIRECT_URI` não bater exatamente com o cadastrado no app do Meta (barra no
  final, http vs https, etc.).
- **Publicação falhando com erro de permissão**: token expirado — clique em Reconectar.
- **Nenhuma página aparece pra conectar**: a Página do Facebook do cliente precisa ter um
  perfil **profissional (Business/Creator)** do Instagram já vinculado a ela (isso se
  configura direto no app do Instagram, em Configurações → Contas vinculadas).
