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
A rota `/erase-everything` apaga todas as informações do banco de dados.
A rota `/list-accesses` retorna um JSON com os acessos.
A rota `/list-classes` retorna um JSON com as aulas.
A rota `/list-tags` retorna um JSON com as tags.

Todas essas rotas só podem ser acessadas com o método GET e o corpo do request dessa seguinte forma:
```json
{
  "Token": "senha"
}
```
Sendo `senha` a string colocada no campo `ADMIN_TOKEN` no arquivo `.env`

Página do administrador disponível no endpoint /admin

### Como desenvolver

#### Primeiros passos
```bash
# Instalar dependências
npm install

# Configurar banco de dados
npx prisma db push

# Iniciar servidor de conexão com a catraca para desenvolvimento
npm run dev

# Iniciar serviço de consulta de alunos e envio de presenças da aula para desenvolvimento
npm run devService
```

#### Macetes
```bash
# Apagar tudo do banco de dados
npx prisma db push --force-reset

# Criar cenário para teste (5 tags, uma para cada caso de uso)
# É necessário ter o leitor de RFID em mãos pois o script pedirá 5 credenciais.
npm run seed
```