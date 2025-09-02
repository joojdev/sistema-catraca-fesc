# 🏊‍♀️ Sistema de Catraca para a Piscina da FESC 🌊

Este projeto é um sistema de middleware 🤖 projetado para integrar uma catraca física com o sistema de gestão externo (SGE) da FESC. Ele gerencia o acesso de usuários à piscina, validando credenciais RFID 💳, verificando horários 🕒 e registrando todos os acessos. O sistema também inclui uma tarefa em segundo plano para sincronizar os dados de usuários e os registros de acesso com a API externa do SGE.

## ✨ Funcionalidades Principais

*   **🚪 Controle de Acesso por RFID**: Valida o acesso de usuários lendo cartões RFID e conferindo as credenciais em um banco de dados local.
*   **🗓️ Validação de Horários**: Garante que os usuários só possam acessar a piscina durante os horários de suas aulas, com um período de tolerância configurável.
*   **👑 Acesso de Administrador**: Permite que administradores ignorem as verificações de horário para ter acesso irrestrito.
*   **🗄️ Banco de Dados Local**: Utiliza SQLite para armazenar dados de usuários, credenciais, horários de aulas e registros de acesso.
*   **🔄 Sincronização de Dados**: Uma tarefa em segundo plano (cron job) sincroniza periodicamente os dados de usuários e aulas da API do SGE e envia os registros de acesso.
*   **🖥️ Interface de Administração Web**: Fornece uma interface web simples para monitoramento e gerenciamento do sistema.
*   **🛡️ Limitação de Requisições (Rate Limiting)**: Protege os endpoints administrativos contra ataques de força bruta.
*   **💪 Resiliência**: Implementa reconexão automática com a catraca e procedimentos de desligamento seguro (graceful shutdown).

## 🏗️ Arquitetura do Sistema

O sistema é composto por dois serviços principais que rodam em conjunto:

1.  **🐠 Serviço da Catraca (`src/index.ts`)**: A aplicação principal que se comunica com o hardware da catraca. Ele escuta as leituras de RFID, valida o acesso e envia os comandos para a catraca.
2.  **🦀 Serviço de Importação/API (`src/infrastructure/tasks/fetch/index.ts`)**: Este serviço executa a tarefa agendada de sincronização com o SGE e fornece uma API REST segura para as tarefas administrativas.

Ambos os serviços compartilham o mesmo banco de dados e a mesma lógica de negócios.

## 🚀 Como Começar

Siga estas instruções para configurar e executar o projeto.

### ✅ Pré-requisitos

*   [Node.js](https://nodejs.org/) (v18 ou superior)
*   [Docker](https://www.docker.com/) e [Docker Compose](https://docs.docker.com/compose/)
*   Um leitor de RFID para os testes 💳

### 🛠️ Instalação

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/joojdev/sistema-catraca-fesc.git
    cd sistema-catraca-fesc
    ```

2.  **Instale as dependências:**
    ```bash
    npm install
    ```

### ⚙️ Configuração

O sistema utiliza variáveis de ambiente. Você precisa criar e configurar o arquivo `.env`.

1.  **Crie um arquivo `.env` a partir do exemplo:**
    ```bash
    cp example.env .env
    ```

2.  **Edite o arquivo `.env` com suas configurações:**
    ```bash
    nano .env
    ```

    Veja a seção [Configuração](#configuração-1) abaixo para detalhes sobre cada variável.

### ▶️ Executando a Aplicação

#### Com Docker (Recomendado para Produção) 🐳

Este é o jeito mais simples de rodar o sistema completo.

```bash
docker-compose up -d --build
```

#### Com Node.js (Para Desenvolvimento) 👨‍💻

Você precisará de dois terminais para rodar os serviços separadamente.

1.  **Configure o banco de dados:**
    ```bash
    npx prisma db push
    ```

2.  **Inicie o Serviço da Catraca:**
    ```bash
    npm run dev
    ```

3.  **Inicie o Serviço de Importação/API (em outro terminal):**
    ```bash
    npm run devService
    ```

## 🕹️ Uso

### 🌐 Interface Administrativa

Acesse a interface de administração em `http://localhost:3000/admin` (ou na porta que você configurou).

Após se autenticar com seu `ADMIN_TOKEN`, você pode:

*   **⚡ Disparar Importação**: Rodar a sincronização de dados manualmente.
*   **📊 Listar Dados**: Ver os acessos, aulas e tags do banco de dados.
*   **🗑️ Apagar Tudo**: Limpar completamente o banco de dados (cuidado!).

### 📡 Endpoints da API

*   `GET /admin`: Página de administração.
*   `GET /health`: Verifica a saúde do sistema.
*   `POST /verify-token`: Valida o token de administrador.
*   `POST /api/trigger-import`: Dispara a importação.
*   `POST /api/list-accesses`: Lista os registros de acesso.
*   `POST /api/list-classes`: Lista as aulas cadastradas.
*   `POST /api/list-tags`: Lista as tags RFID cadastradas.
*   `POST /api/erase-everything`: Apaga todos os dados.

**Exemplo de Requisição:**

```bash
curl -X POST http://localhost:3000/api/list-accesses \
     -H "Content-Type: application/json" \
     -d '{"Token": "seu_admin_token"}'
```

## 🔩 Configuração

As variáveis de ambiente no seu arquivo `.env`:

| Variável          | Descrição                                         | Exemplo                    |
| ----------------- | ------------------------------------------------- | -------------------------- |
| `TURNSTILE_IP`    | IP da catraca.                                    | `192.168.1.100`            |
| `TURNSTILE_PORT`  | Porta do servidor TCP da catraca.                 | `5555`                     |
| `DELAY_TOLERANCE` | Tolerância em minutos para entrada (antes/depois).| `15`                       |
| `TIMEZONE`        | Fuso horário para cálculos de data/hora.          | `America/Sao_Paulo`        |
| `LOG_LEVEL`       | Nível do log (`info`, `debug`, `error`).          | `info`                     |
| `API_URL`         | URL base da API do SGE.                           | `https://api.sge.com/`     |
| `API_TOKEN`       | Token de autenticação para a API do SGE.          | `sge_api_secret_token`     |
| `CRON_PARAMETERS` | Padrão cron para a sincronização agendada.        | `0 */6 * * *`              |
| `ADMIN_TOKEN`     | Token secreto para a API administrativa.          | `minha_senha_super_secreta`|
| `PORT`            | Porta do servidor da API administrativa.          | `3000`                     |

## 👨‍🔬 Desenvolvimento

### 📜 Scripts e Comandos

*   `npm run dev`: Inicia o serviço da catraca com hot-reloading.
*   `npm run devService`: Inicia o serviço da API com hot-reloading.
*   `npm run build`: Compila o TypeScript para JavaScript.
*   `npm run lint`: Verifica a qualidade do código com ESLint.
*   `npm run seed`: Popula o banco de dados com dados de teste.
*   `npx prisma db push --force-reset`: Reseta o banco de dados.

### 🪵 Logging

A aplicação usa [Pino](https://getpino.io/) para logs. Em desenvolvimento, os logs são formatados de forma bonita com `pino-pretty` para facilitar a leitura.

## 💖 Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo `LICENSE` para mais detalhes.
