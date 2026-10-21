# Exclusive Solario

Site público e CRM da Exclusive Solario, em português de Portugal. O site capta pedidos de informação; o formulário cria automaticamente uma ficha de interessado na mesma agenda usada para os clientes registados manualmente.

## Funcionalidades

- Site adaptado a telemóvel, com fotografias do Instagram, vídeos Reels incorporados, animação decorativa e formulário de contacto.
- `/gestao/`: clientes, interessados, visitas, acompanhamentos, vendas, renovações, pesquisa, importação de folha de cálculo e exportação de cópia de segurança.
- Pedidos do site guardados na agenda de clientes com o estado “Interessado”.
- Sessão de gestão protegida por Netlify Identity e registos partilhados na Netlify Database.
- `/privacidade/`: informação sobre os dados recolhidos pelo formulário.

## Configuração no Netlify

1. Liga este repositório ao projeto Netlify `exclusive-solario-maia` e publica a branch `main`.
2. Define a variável de ambiente `CRM_ADMIN_EMAIL` com o email da conta autorizada a usar o CRM.
3. Ativa Netlify Identity com inscrições públicas desativadas. Convida apenas a conta administradora autorizada.
4. A publicação provisiona a Netlify Database e aplica a migração em `netlify/database/migrations/`.
5. Confirma o domínio do projeto e o URL de retorno dos emails de convite e recuperação de palavra-passe antes de enviar o convite.

O serviço não contém clientes de demonstração. O CRM só fica acessível depois de o Identity e a variável do administrador estarem configurados no Netlify.

## Desenvolvimento

Requer Node.js 20.12 ou superior.

```sh
npm install
npm run build
npm test
```

O build gera `dist/gestao/identity.bundle.js`. A Netlify CLI pode ser usada para testar as funções e a base de dados num ambiente ligado ao projeto.

## Dados e cópias

As cópias exportadas pelo CRM são ficheiros JSON que contêm dados pessoais. Guarda-as num local protegido e elimina-as quando deixarem de ser necessárias. A pasta `dist/` contém os ficheiros estáticos publicados.
