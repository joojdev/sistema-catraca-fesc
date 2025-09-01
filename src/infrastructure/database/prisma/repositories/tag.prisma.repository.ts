import Tag from '@/domain/entities/tag.entity'
import TagRepository, {
  CreateTagInput,
  CredentialInput,
} from '@/domain/repositories/tag.repository'
import { prisma } from '@/infrastructure/database/prisma'

/**
 * Implementação do repositório de tags usando Prisma ORM
 *
 * Responsabilidades:
 * - Traduzir operações de domínio para queries Prisma
 * - Garantir integridade referencial
 * - Otimizar consultas para performance
 * - Tratar erros de banco de dados
 */
export default class TagPrismaRepository implements TagRepository {
  /**
   * Cria ou atualiza tag usando operação upsert
   *
   * Estratégia upsert:
   * - WHERE userId: busca tag existente por usuário
   * - UPDATE: atualiza dados se encontrar
   * - CREATE: cria nova se não existir
   *
   * Vantagens:
   * - Operação atômica (evita race conditions)
   * - Previne duplicatas por usuário
   * - Permite atualizações de credencial/status
   */
  async createOrUpdate(data: CreateTagInput): Promise<Tag> {
    return (await prisma.tag.upsert({
      where: {
        userId: data.userId, // Chave de busca: um usuário = uma tag
      },
      update: {
        // Campos atualizáveis em tags existentes
        credential: data.credential, // Permite troca de credencial física
        released: data.released, // Permite bloquear/liberar acesso
        status: data.status, // Atualiza status textual
        admin: data.admin, // Permite alterar privilégios
      },
      create: {
        // Dados para nova tag
        credential: data.credential,
        userId: data.userId,
        released: data.released,
        status: data.status,
        admin: data.admin,
      },
    })) as Tag
  }

  /**
   * Busca tag pela credencial RFID
   *
   * Usado pela catraca para:
   * - Validar se credencial existe
   * - Obter dados do usuário associado
   * - Verificar permissões (admin, released)
   *
   * Performance:
   * - Index único em 'credential' garante busca rápida
   * - findUnique é otimizado para chaves únicas
   */
  async getByCredential(data: CredentialInput): Promise<Tag | null> {
    return (await prisma.tag.findUnique({
      where: {
        credential: data.credential, // Busca por número da credencial
      },
      // Possível otimização futura: incluir dados relacionados
      // include: { user: true } se necessário
    })) as Tag | null
  }

  /**
   * Remove todas as tags - OPERAÇÃO DESTRUTIVA
   *
   * Cuidados:
   * - Remove cascata (pode afetar relacionamentos)
   * - Irreversível - fazer backup antes
   * - Usar apenas em manutenção/reset
   */
  async eraseAll(): Promise<void> {
    await prisma.tag.deleteMany({
      // Sem filtros = deleta tudo
      // Prisma automaticamente gerencia transações
    })
  }

  /**
   * Lista todas as tags do sistema
   *
   * Usos:
   * - Relatórios administrativos
   * - Auditoria de credenciais
   * - Exportação de dados
   *
   * Performance:
   * - Para muitos registros, considerar paginação
   * - Possível adicionar filtros/ordenação
   */
  async getAll(): Promise<Tag[]> {
    return (await prisma.tag.findMany({
      // Possíveis melhorias futuras:
      // orderBy: { userId: 'asc' }, // Ordenação
      // select: { ... }, // Projeção de campos específicos
      // take: 1000, // Limitação para performance
    })) as Tag[]
  }
}
