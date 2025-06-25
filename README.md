# Sistema de Catraca da Piscina da FESC

## Funcionamento Geral

Este sistema permitirá a administração do acesso de pessoas na piscina da FESC, enquanto marca presença dos alunos nas aulas correntes, com base nos dados acessados na plataforma SGE da FESC.

## Funcionamento Aprofundado

### Comunicação com SGE

Todos os dias pela manhã, o sistema irá acessar a API da plataforma SGE da FESC, buscando usuários e horários relevantes. Onde o SGE vai selecionar os alunos aptos a utilizar a piscina (precisa estar em uma turma que utiliza a piscina e contas em dia), e enviar de volta para o servidor de catracas.
O retorno esperado da API ainda precisa ser escolhido:

**Horários agrupados por usuários**

```json
[
  {
    "aluno_id": 32132,
    "credencial": 7849338479,
    "horarios": [
      ["13:00", "14:30"],
      ["16:00", "17:00"]
    ]
  }
]
```

**Usuários agrupados por horários**

```json
[
  {
    "inicio": "13:00",
    "fim": "14:30",
    "alunos": [
      {
        "aluno_id": 32132,
        "credencial": 7849338479
      }
    ]
  }
]
```

Além da sincronização dos dados do SGE com este sistema, existe também o protocolo para marcar presença na aula em que o usuário utiliza a catraca para participar, automaticamente. Se levarmos em conta que o usuário só pode se cadastrar em uma aula por período (obrigatório para não haver conflitos), é possível identificar a aula em questão pelo horário de acesso e credencial do usuário. Nessas circunstâncias, as presenças seriam enviadas em pacotes, periodicamente, para a API do SGE. O retorno da API deve mostrar se houve sucesso ou não, permitindo a geração de relatórios no futuro.

### Comunicação com a Catraca

A comunicação com a catraca será feita com o protocolo TCP. Essa parte da documentação está em andamento.