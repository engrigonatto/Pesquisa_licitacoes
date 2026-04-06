import { GoogleGenAI, Type } from "@google/genai";
import { Bidding, SearchFilters } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function searchBiddings(filters: SearchFilters): Promise<Bidding[]> {
  const { query, type, entityType, biddingType, minDate, maxDate, minValue, maxValue } = filters;

  const prompt = `
    Atue como um especialista em licitações brasileiras com acesso a dados históricos e atuais. 
    Busque licitações que correspondam EXATAMENTE aos seguintes critérios:
    - Palavra-chave no objeto: "${query}"
    - Tipo de portal: ${type === 'all' ? 'públicos e privados' : type === 'public' ? 'apenas públicos' : 'apenas privados'}
    ${entityType && entityType !== 'all' ? `- Esfera/Órgão: ${entityType}` : ''}
    ${filters.state && filters.state !== 'all' ? `- Estado (UF): ${filters.state}` : ''}
    ${biddingType ? `- Modalidade de licitação: ${biddingType}` : ''}
    ${minDate || maxDate ? `- INTERVALO DE DATAS: De ${minDate || 'qualquer data'} até ${maxDate || 'hoje'}. Busque em arquivos históricos se necessário para cobrir todo o período solicitado.` : '- Período: Licitações recentes (últimos 30-90 dias)'}
    ${minValue ? `- Valor mínimo estimado: R$ ${minValue}` : ''}
    ${maxValue ? `- Valor máximo estimado: R$ ${maxValue}` : ''}

    IMPORTANTE: 
    1. Se um intervalo de datas foi fornecido, priorize encontrar licitações publicadas dentro desse período, mesmo que não sejam as mais recentes.
    2. Se uma modalidade específica (ex: Pregão Eletrônico) foi solicitada, filtre rigorosamente por ela.
    3. Consulte portais como Compras.gov.br (antigo Comprasnet), Licitações-e (Banco do Brasil), Portal Nacional de Contratações Públicas (PNCP), BLL, portais de transparência estaduais e municipais, e plataformas privadas como BBMNET e outras.
    
    Retorne uma lista de licitações encontradas no formato JSON.
    Cada item deve ter:
    - title: Título curto da licitação
    - object: Descrição detalhada do objeto
    - biddingNumber: Número do pregão ou edital
    - processNumber: Número do processo
    - portal: Nome do portal onde foi encontrada
    - link: URL direta para a licitação ou edital
    - type: 'public' ou 'private'
    - entityType: 'municipal', 'state', 'federal' ou 'private'
    - biddingType: Modalidade (ex: Pregão Eletrônico, Concorrência, etc.)
    - estimatedValue: Valor estimado formatado como moeda (R$)
    - date: Data de publicação ou abertura formatada (DD/MM/AAAA)
    - location: Cidade e Estado do órgão licitante (ex: São Paulo - SP)
    - latitude: Latitude aproximada do local
    - longitude: Longitude aproximada do local

    Seja preciso e forneça links reais.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              object: { type: Type.STRING },
              biddingNumber: { type: Type.STRING },
              processNumber: { type: Type.STRING },
              portal: { type: Type.STRING },
              link: { type: Type.STRING },
              type: { type: Type.STRING, enum: ["public", "private"] },
              entityType: { type: Type.STRING, enum: ["municipal", "state", "federal", "private"] },
              biddingType: { type: Type.STRING },
              estimatedValue: { type: Type.STRING },
              date: { type: Type.STRING },
              location: { type: Type.STRING },
              latitude: { type: Type.NUMBER },
              longitude: { type: Type.NUMBER },
            },
            required: ["title", "object", "biddingNumber", "processNumber", "portal", "link", "type", "location", "latitude", "longitude"],
          },
        },
      },
    });

    const text = response.text;
    if (!text) return [];
    
    const biddings = JSON.parse(text) as Bidding[];
    return biddings.map((b, index) => ({
      ...b,
      id: `${Date.now()}-${index}`
    }));
  } catch (error) {
    console.error("Error searching biddings:", error);
    return [];
  }
}

export async function summarizeBiddings(biddings: Bidding[]): Promise<string> {
  if (biddings.length === 0) return "Nenhuma licitação para resumir.";

  const biddingsText = biddings.map(b => `- ${b.title}: ${b.object} (Valor: ${b.estimatedValue || 'Não informado'})`).join('\n');

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Gere um relatório resumido e profissional das seguintes licitações, destacando as principais oportunidades, tendências de valores e objetos mais comuns. O relatório deve ser em português e formatado em Markdown:\n\n${biddingsText}`,
  });

  return response.text || "Não foi possível gerar o resumo.";
}
