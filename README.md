# Sistema de Catraca da Piscina da FESC

## Funcionamento Geral

Este sistema permitirá a administração do acesso de pessoas na piscina da FESC, enquanto marca presença dos alunos nas aulas correntes, com base nos dados acessados na plataforma SGE da FESC.

### Como rodar

```bash
# Baixar projeto
git clone https://github.com/joojdev/sistema-catraca-fesc.git
cd sistema-catraca-fesc

# Configurar variáveis de ambiente
cp example.env .env
nano .env

# Fazer build da imagem e escalar container
docker compose up -d --build
```

Na mesma máquina do servidor, se você enviar um request GET para `http://localhost:3000/trigger-import`, as importações e exportações são executadas.

### Como desenvolver

```bash
# Instalar dependências
npm install

# Iniciar servidor de conexão com a catraca para desenvolvimento
npm run dev

# Iniciar serviço de consulta de alunos e envio de presenças da aula para desenvolvimento
npm run devService
```