# Exclusive Solario

Site público e CRM da Exclusive Solario, em português de Portugal. O site capta pedidos de informação; o formulário cria automaticamente uma ficha de interessado na mesma agenda usada para os clientes registados manualmente.

## Funcionalidades

- Site adaptado a telemóvel, com fotografias do Instagram, vídeos Reels incorporados, animação decorativa e formulário de contacto.
- `/gestao/`: clientes, interessados, visitas, acompanhamentos, vendas, renovações, pesquisa, importação de folha de cálculo e exportação de cópia de segurança.
- Pedidos do site guardados na agenda de clientes com o estado “Interessado”.
- Sessão de gestão através do Supabase Auth do projeto Indigo, partilhado com o SD Dialer.
- Registos da Exclusive Solario isolados na tabela **public.solario_crm_records**, com Row Level Security. O código não lê nem altera tabelas do SD Dialer.
- `/privacidade/`: informação sobre os dados recolhidos pelo formulário.

## Configuração no Supabase e Netlify

1. As migrações em **supabase/migrations/** criam a tabela exclusiva do Solario, limitam as permissões do formulário público e configuram as políticas RLS.
2. No Supabase Indigo, adiciona a conta administradora em **Authentication → Users**. Não é preciso criar uma linha em **public.sellers**; essa tabela continua reservada ao Dialer.
3. Se a caixa de correio do administrador ainda não existir, confirma a conta no painel do Supabase para permitir o primeiro início de sessão. A recuperação por email só ficará disponível quando essa caixa funcionar.
4. Em **Authentication → URL Configuration**, permite o URL de gestão do site, por exemplo **https://exclusive-solario-maia.netlify.app/gestao/**. Acrescenta também o domínio próprio quando estiver configurado.
5. Liga este repositório ao projeto Netlify **exclusive-solario-maia**, com comando de build **npm run build** e pasta de publicação **dist**.

O CRM permite entrar apenas com o email administrador definido no código e confirmado pelas políticas RLS. Os pedidos públicos podem inserir apenas fichas limitadas a interessados; visitantes não podem consultar os registos.

## Desenvolvimento

Requer Node.js 20.12 ou superior.

```sh
npm install
npm run build
```

O build copia a configuração pública do Supabase e o cliente de autenticação para **dist/**. A chave publishable do Supabase é própria para código de browser; nunca coloques uma chave **service_role** no site.

## Dados e cópias

As cópias exportadas pelo CRM são ficheiros JSON que contêm dados pessoais. Guarda-as num local protegido e elimina-as quando deixarem de ser necessárias. A pasta **dist/** contém os ficheiros estáticos publicados.
