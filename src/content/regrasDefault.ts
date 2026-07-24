/**
 * Texto-base das Regras do Aluguer. É apenas o RASCUNHO inicial — o texto real
 * vive na base de dados e edita-se em /admin/regras (cada gravação cria uma
 * versão nova com hash, para a prova de aceitação). Ajusta os valores concretos
 * (caução, franquia, prazos) e revê com apoio jurídico antes de usar a sério.
 */
export const REGRAS_RASCUNHO = `# Regras do Aluguer — GoScooters

## 1. Objeto
A GoScooters entrega ao motorista a mota identificada no contrato, para uso
próprio (incluindo atividade profissional de entregas/transporte). A mota não
pode ser cedida, subalugada ou conduzida por terceiros.

## 2. Pagamento (pay and ride)
A renda é semanal e paga ADIANTADA no dia acordado na entrega. Cada pagamento dá
direito a uma semana de utilização. O não pagamento na data pode levar à recolha
imediata da mota.

## 3. Caução
É prestada uma caução no valor definido no contrato. Será devolvida no fim do
aluguer, deduzidos eventuais danos, dívidas, multas ou custos em falta.

## 4. Combustível
A mota é entregue e deve ser devolvida com o mesmo nível de combustível
registado na vistoria de entrega.

## 5. Manutenção e avarias
A manutenção regular é assegurada pela GoScooters (ou pelo proprietário). O
motorista compromete-se a comunicar qualquer avaria ou anomalia de imediato e a
não circular com a mota em condições inseguras.

## 6. Danos e acidentes
O motorista é responsável por danos resultantes de uso indevido, negligência ou
incumprimento das regras. Em caso de acidente, deve comunicar à GoScooters no
prazo de 24 horas e preencher a declaração amigável. Aplica-se a franquia
definida no contrato.

## 7. Multas, coimas e portagens
Todas as multas, coimas e portagens durante o período de aluguer são da
responsabilidade do motorista e ser-lhe-ão refaturadas.

## 8. Documentos, carta e capacete
O motorista conduz sempre com carta de condução válida e adequada à categoria da
mota, e com capacete. Os documentos da mota devem permanecer na mota.

## 9. Seguro
A mota dispõe de seguro nos termos indicados no contrato. O motorista respeita as
condições da apólice; a condução sem carta válida invalida a cobertura.

## 10. Devolução
A mota é devolvida no estado da vistoria de entrega (fotos e vídeo), salvo
desgaste normal, com o pré-aviso acordado.

## 11. Dados pessoais (RGPD)
Os dados e documentos recolhidos são tratados apenas para a gestão do aluguer,
conforme a política de privacidade, e conservados apenas o tempo necessário.

Ao aceitar, o motorista declara ter lido e compreendido estas regras.`;
