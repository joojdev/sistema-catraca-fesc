# Sistema de Catraca da Piscina da FESC

## Funcionamento Geral

Este sistema permitirá a administração do acesso de pessoas na piscina da FESC, enquanto marca presença dos alunos nas aulas correntes, com base nos dados acessados na plataforma SGE da FESC.

### Como rodar

```bash
# Baixar projeto
git clone https://github.com/joojdev/sistema-catraca-fesc.git
cd sistema-catraca-fesc

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp example.env .env
nano .env

# Configurar banco de dados
npx prisma db push

# Compilar Typescript para Javascript
npm run build

# Executar servidor que conversa com a catraca
npm run start
# Executar servidor que conversa com o SGE
npm run startService
```

## Funcionamento Aprofundado

### Comunicação com SGE

Documentação em andamento...

### Comunicação com a Catraca

A comunicação com a catraca será feita com o protocolo TCP. Essa parte da documentação está em andamento.
