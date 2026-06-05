import { addChunk } from '../services/knowledge.js';

const KNOWLEDGE_DATA = [
  {
    category: 'produto',
    aida_phase: 'general',
    content: 'O LipedemaCare é uma plataforma completa de tratamento para lipedema. Foi criado por mulheres que entendem exatamente o que você está passando. Inclui videoaulas, exercícios guiados, receitas, comunidade de apoio e lembretes inteligentes.'
  },
  {
    category: 'produto',
    aida_phase: 'interest',
    content: 'O LipedemaCare oferece: Acompanhamento diário de sintomas, Exercícios guiados específicos para lipedema, Monitoramento de saúde (circunferência, peso, dor), Comunidade de apoio, Educação continuada com artigos e vídeos, Lembretes inteligentes para medicamentos e consultas.'
  },
  {
    category: 'beneficios',
    aida_phase: 'desire',
    content: 'Redução da Dor e Inchaço: Com técnicas de drenagem linfática e exercícios adaptados, você pode sentir alívio real e duradouro dos sintomas. Muitas pacientes relatam melhora significativa em poucas semanas.'
  },
  {
    category: 'beneficios',
    aida_phase: 'desire',
    content: 'Recuperação da Mobilidade: Volte a fazer as coisas que você amava. Caminhar, brincar, se movimentar livremente sem a constante dor te limitando. Exercícios progressivos que respeitam seu ritmo.'
  },
  {
    category: 'beneficios',
    aida_phase: 'desire',
    content: 'Comunidade Que Entende: Conecte-se com outras mulheres que vivem a mesma realidade. Compartilhe experiências, receba apoio e nunca mais se sinta sozinha. Mais de 500 mulheres já estão cuidando delas.'
  },
  {
    category: 'beneficios',
    aida_phase: 'desire',
    content: 'Recuperação da Autoestima: Aprenda a se amar novamente, aceitar seu corpo e focar no que realmente importa: sua saúde e seu bem-estar. O lipedema não define quem você é.'
  },
  {
    category: 'preco',
    aida_phase: 'action',
    content: 'O LipedemaCare custa R$37,90 por mês. São menos de R$1,30 por dia - menos que um café! Você pode cancelar a qualquer momento, sem multa ou burocracia.'
  },
  {
    category: 'preco',
    aida_phase: 'desire',
    content: 'Quanto tempo você já gastou tentando resolver o lipedema? Remédios, consultas, tratamentos que não funcionam? O LipedemaCare são R$37,90/mês, menos que R$1,30 por dia. Um investimento pequeno para uma grande mudança na sua qualidade de vida.'
  },
  {
    category: 'exercicios',
    aida_phase: 'interest',
    content: 'O LipedemaCare tem exercícios guiados específicos para lipedema, com vídeos e instruções passo a passo. São exercícios de baixo impacto que podem ser feitos em casa, respeitando os limites do seu corpo.'
  },
  {
    category: 'exercicios',
    aida_phase: 'desire',
    content: 'Posso te mandar um exercício que alivia a dor agora? É um exercício simples de drenagem linfática que nossas pacientes adoram. Não custa nada experimentar!'
  },
  {
    category: 'comunidade',
    aida_phase: 'desire',
    content: 'No LipedemaCare você encontra uma comunidade de mais de 500 mulheres que estão passando pelo mesmo que você. Compartilhem experiências, dicas e se apoiem mutuamente. Ninguém deveria enfrentar o lipedema sozinha.'
  },
  {
    category: 'faq',
    aida_phase: 'general',
    content: 'Pergunta: Funciona para varizes? Resposta: O LipedemaCare é focado em lipedema, mas os exercícios de drenagem linfática podem ajudar com a circulação em geral. Consulte seu médico para orientação específica.'
  },
  {
    category: 'faq',
    aida_phase: 'general',
    content: 'Pergunta: Precisa de equipmento? Resposta: Não! Todos os exercícios podem ser feitos em casa, sem equipmento especial. Você só precisa de um espaço confortável e roupas confortáveis.'
  },
  {
    category: 'faq',
    aida_phase: 'general',
    content: 'Pergunta: Em quanto tempo vou ver resultados? Resposta: Muitas pacientes relatam melhora em 2-4 semanas. Mas cada corpo é diferente. O importante é a consistência - continue praticando e você verá resultados.'
  },
  {
    category: 'urgencia',
    aida_phase: 'action',
    content: 'Quanto antes você começar o tratamento, mais rápido vai sentir alívio. Cada dia sem tratamento é mais um dia com dor e limitação. Não deixe para depois - seu corpo merece cuidado agora.'
  },
  {
    category: 'urgencia',
    aida_phase: 'action',
    content: 'O lipedema é progressivo - sem tratamento, piora com o tempo. Comece hoje para evitar complicações amanhã. O LipedemaCare é o caminho mais acessível e eficaz para cuidar de você.'
  }
];

async function seed() {
  console.log('Seeding knowledge base...');

  for (const item of KNOWLEDGE_DATA) {
    try {
      await addChunk(item.category, item.aida_phase, item.content);
      console.log(`Added: [${item.category}] ${item.content.substring(0, 50)}...`);
    } catch (error) {
      console.error(`Failed: ${error.message}`);
    }
  }

  console.log('Seeding complete!');
}

seed();
