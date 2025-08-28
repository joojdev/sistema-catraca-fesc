import { PrismaClient, WeekDay } from '@prisma/client'
import { createInterface } from 'readline'
import dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
})

const DELAY_TOLERANCE = parseInt(process.env.DELAY_TOLERANCE || '10', 10)
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo'

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve)
  })
}

function getCurrentTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }))
}

function timeToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

async function clearExistingData() {
  console.log('🗑️  Limpando dados existentes...')
  await prisma.access.deleteMany()
  await prisma.class.deleteMany()
  await prisma.tag.deleteMany()
  console.log('✅ Dados limpos com sucesso!\n')
}

async function createSchedule(
  userId: number,
  startMinutes: number,
  weekDay: string,
) {
  await prisma.class.create({
    data: {
      start: startMinutes,
      weekDay: weekDay as WeekDay,
      tagUserId: userId,
    },
  })
}

async function main() {
  console.log('🎯 Script de Seed - Sistema de Catraca FESC')
  console.log('='.repeat(50))
  console.log(`⏰ Horário atual: ${getCurrentTime().toLocaleString('pt-BR')}`)
  console.log(`⏱️  Tolerância configurada: ${DELAY_TOLERANCE} minutos`)
  console.log(`🌍 Timezone: ${TIMEZONE}\n`)

  await clearExistingData()

  const currentTime = getCurrentTime()
  const currentMinutes = timeToMinutes(currentTime)
  const weekDays = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]
  const today = weekDays[currentTime.getDay()]

  console.log('📝 Insira os 5 RFIDs (apenas números):')

  const rfids: number[] = []

  // Coleta dos RFIDs
  for (let i = 1; i <= 5; i++) {
    const input = await prompt(`RFID ${i}: `)
    const rfid = parseInt(input.trim(), 10)

    if (isNaN(rfid)) {
      console.log('❌ RFID inválido! Digite apenas números.')
      i-- // Repete a pergunta
      continue
    }

    rfids.push(rfid)
  }

  console.log('\n🔧 Criando dados de teste...\n')

  // 1. RFID Admin (sem horário)
  console.log(`👑 RFID ${rfids[0]} - ADMIN (sem restrição de horário)`)
  await prisma.tag.create({
    data: {
      userId: 1,
      credential: rfids[0],
      released: true,
      status: 'ADMINISTRADOR',
      admin: true,
    },
  })

  // 2. RFID com horário válido (dentro da janela)
  const validTime = currentMinutes
  console.log(
    `✅ RFID ${rfids[1]} - DENTRO DO HORÁRIO (${minutesToTime(validTime)})`,
  )
  await prisma.tag.create({
    data: {
      userId: 2,
      credential: rfids[1],
      released: true,
      status: 'ALUNO ATIVO',
      admin: false,
    },
  })
  await createSchedule(2, validTime, today)

  // 3. RFID muito cedo (antes da janela)
  const earlyTime = currentMinutes + DELAY_TOLERANCE + 30 // 30 min após a janela
  console.log(
    `🕐 RFID ${rfids[2]} - MUITO CEDO (aula às ${minutesToTime(earlyTime)})`,
  )
  await prisma.tag.create({
    data: {
      userId: 3,
      credential: rfids[2],
      released: true,
      status: 'ALUNO ATIVO',
      admin: false,
    },
  })
  await createSchedule(3, earlyTime, today)

  // 4. RFID muito tarde (depois da janela)
  const lateTime = Math.max(0, currentMinutes - DELAY_TOLERANCE - 30) // 30 min antes da janela
  console.log(
    `🕐 RFID ${rfids[3]} - MUITO TARDE (aula foi às ${minutesToTime(lateTime)})`,
  )
  await prisma.tag.create({
    data: {
      userId: 4,
      credential: rfids[3],
      released: true,
      status: 'ALUNO ATIVO',
      admin: false,
    },
  })
  await createSchedule(4, lateTime, today)

  // 5. RFID bloqueado (dentro do horário mas com pagamento atrasado)
  const blockedTime = currentMinutes
  console.log(
    `🚫 RFID ${rfids[4]} - PAGAMENTO ATRASADO (horário ${minutesToTime(blockedTime)})`,
  )
  await prisma.tag.create({
    data: {
      userId: 5,
      credential: rfids[4],
      released: false,
      status: 'PROCURE A SECRETARIA',
      admin: false,
    },
  })
  await createSchedule(5, blockedTime, today)

  console.log('\n📊 Resumo dos dados criados:')
  console.log('='.repeat(50))

  const tags = await prisma.tag.findMany({
    include: { classes: true },
  })

  tags.forEach((tag, index) => {
    const scenarios = [
      '👑 ADMIN - Acesso liberado sempre',
      '✅ DENTRO DO HORÁRIO - Deve permitir acesso',
      '⏰ MUITO CEDO - Deve negar acesso (fora de horário)',
      '⏰ MUITO TARDE - Deve negar acesso (fora de horário)',
      '🚫 PAGAMENTO ATRASADO - Deve negar acesso (bloqueado)',
    ]

    console.log(`\nRFID: ${tag.credential}`)
    console.log(`Cenário: ${scenarios[index]}`)
    console.log(`Status: ${tag.status}`)
    console.log(`Released: ${tag.released}`)
    console.log(`Admin: ${tag.admin}`)

    if (tag.classes.length > 0) {
      const classTime = minutesToTime(tag.classes[0].start)
      const windowStart = minutesToTime(tag.classes[0].start - DELAY_TOLERANCE)
      const windowEnd = minutesToTime(tag.classes[0].start + DELAY_TOLERANCE)
      console.log(`Horário da aula: ${classTime}`)
      console.log(`Janela válida: ${windowStart} - ${windowEnd}`)
    }
  })

  console.log('\n✅ Seed executado com sucesso!')
  console.log('\n🧪 Para testar, use os RFIDs criados no sistema de catraca.')
  console.log(
    `📋 Horário atual para referência: ${getCurrentTime().toLocaleString('pt-BR')}`,
  )
}

main()
  .catch((e) => {
    console.error('❌ Erro ao executar seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    rl.close()
  })
