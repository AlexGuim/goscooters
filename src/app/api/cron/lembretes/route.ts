import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enviarLembrete, smsConfigurado, whatsappConfigurado } from "@/lib/sms";
import { formatarPreco } from "@/lib/precos";
import { textoLembrete } from "@/lib/lembretes";
import { varrerDerivadas } from "@/lib/notificacoesDerivadas";
import { enviarTelegramTexto } from "@/lib/notifications";

/**
 * Rotina diária de lembretes de pagamento (chamada pelo Vercel Cron).
 *
 * Encontra as cobranças que vencem AMANHÃ e ainda estão por liquidar, e envia
 * um SMS ao motorista. Envia-te também um resumo por email do que foi feito.
 *
 * Segurança: o Vercel Cron envia `Authorization: Bearer <CRON_SECRET>`. Sem o
 * cabeçalho certo, recusa — para o endpoint não poder ser disparado por qualquer um.
 */
export async function GET(request: NextRequest) {
  // Fail-closed: sem CRON_SECRET definido, o endpoint (que gasta SMS e lê dados
  // de motoristas) fica FECHADO em vez de aberto a qualquer um.
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    console.error("CRON_SECRET não definido — a recusar a execução por segurança.");
    return new NextResponse("Cron não configurado (falta CRON_SECRET).", { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Geração rolante (cobrança aberta): garante que cada contrato ativo tem
  // cobranças geradas até ~2 semanas à frente. Sem data de fim — a faturação só
  // para quando o contrato é terminado (evento explícito). fn_gerar_cobrancas é
  // idempotente, por isso isto apenas acrescenta a semana que falta.
  const horizonte = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const { data: ativos } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id")
    .in("estado", ["ativo", "pendente_fecho"])
    .not("ancora_vencimento", "is", null);
  let geradas = 0;
  for (const ct of ativos ?? []) {
    const { data: n, error: genErr } = await supabaseAdmin.rpc("fn_gerar_cobrancas", {
      p_contrato_id: ct.id,
      p_ate: horizonte,
    });
    if (genErr) console.error(`[cron] gerar cobranças ${ct.id}:`, genErr.message);
    else geradas += n ?? 0;
  }

  // Recalcula as notificações DERIVADAS do estado (caixa do gestor): contrato sem
  // faturação, à espera de recolha, KYC incompleto, cobranças em atraso.
  const derivadas = await varrerDerivadas();

  // Alertas proativos do dia (seguro/manutenção/documentos a expirar): empurra um
  // resumo por Telegram ao gestor. Corre sempre — mesmo que nada vença amanhã.
  const { data: alertas } = await supabaseAdmin
    .from("notificacao")
    .select("tipo, titulo, detalhe")
    .in("tipo", ["seguro_a_expirar", "manutencao_a_vencer", "doc_motorista_a_expirar"])
    .neq("estado", "feita");
  const linhasAlerta = (alertas ?? []).map((a) => `• ${a.detalhe ?? a.titulo}`);
  let alertasEnviados = false;
  if (linhasAlerta.length) {
    alertasEnviados = await enviarTelegramTexto(
      `⚠️ *Alertas GoScooters* (${linhasAlerta.length})\n\n${linhasAlerta.join("\n")}`,
    );
  }

  // "Amanhã" (aproximação UTC — algumas horas de desvio são irrelevantes num lembrete).
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const { data: cobrancas, error } = await supabaseAdmin
    .from("vw_cobranca_estado")
    .select("*")
    .eq("data_vencimento", amanha)
    // A caução não é renda (é cobrada em mão na entrega) — não a "dunar" com o
    // texto de renda a vencer. Renda e extras (coimas) mantêm-se.
    .neq("tipo", "caucao")
    .in("estado_liquidacao", ["por_liquidar", "parcial"]);

  if (error) {
    console.error("[lembretes] erro a ler cobranças:", error);
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }

  const alvo = cobrancas ?? [];
  if (alvo.length === 0) {
    return NextResponse.json({ ok: true, amanha, geradas, derivadas: derivadas.inseridas, alertas: linhasAlerta.length, alertasEnviados, total: 0, mensagem: "Nada vence amanhã." });
  }

  // Telefones e nomes dos motoristas envolvidos.
  const motIds = [...new Set(alvo.map((c) => c.motorista_id as string))];
  const { data: mots } = await supabaseAdmin
    .from("motorista")
    .select("id, nome, telefone_e164, idioma_preferido")
    .in("id", motIds);
  const infoMot = new Map((mots ?? []).map((m) => [m.id, m]));

  const { data: motos } = await supabaseAdmin.from("moto").select("id, matricula");
  const matricula = new Map((motos ?? []).map((m) => [m.id, m.matricula]));

  const resultados: { nome: string; estado: string }[] = [];
  let enviados = 0;

  for (const c of alvo) {
    const m = infoMot.get(c.motorista_id as string);
    const nome = m?.nome ?? "motorista";
    const e164 = m?.telefone_e164 ?? null;
    const mat = matricula.get(c.veiculo_id as string) ?? "";

    if (!e164) {
      resultados.push({ nome, estado: "sem telefone E.164" });
      continue;
    }

    const texto = textoLembrete(
      {
        nome,
        matricula: mat,
        data: `${amanha.slice(8, 10)}/${amanha.slice(5, 7)}`,
        valor: formatarPreco(String(c.em_falta)),
      },
      m?.idioma_preferido,
    );

    const r = await enviarLembrete(e164, texto);
    if (r.ok) {
      enviados++;
      resultados.push({ nome, estado: `enviado (${r.canal})` });
    } else {
      console.error(`[lembretes] falha para ${nome}:`, r.erro);
      resultados.push({ nome, estado: `falhou: ${r.erro}` });
    }
  }

  // Resumo por email ao admin (usa o Resend já configurado, se existir).
  await enviarResumoAdmin(amanha, resultados, enviados, linhasAlerta);

  return NextResponse.json({
    ok: true,
    amanha,
    geradas,
    derivadas: derivadas.inseridas,
    alertas: linhasAlerta.length,
    alertasEnviados,
    total: alvo.length,
    enviados,
    canal: whatsappConfigurado() ? "whatsapp" : smsConfigurado() ? "sms" : "nenhum",
    resultados,
  });
}

async function enviarResumoAdmin(
  amanha: string,
  resultados: { nome: string; estado: string }[],
  enviados: number,
  linhasAlerta: string[] = [],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const destinatario = process.env.ADMIN_EMAIL;
  if (!apiKey || !destinatario) return;

  const linhas = resultados.map((r) => `• ${r.nome}: ${r.estado}`).join("\n");
  const seccaoAlertas = linhasAlerta.length
    ? `\n\n⚠️ Alertas (${linhasAlerta.length}): seguros/manutenção/documentos a expirar\n${linhasAlerta.join("\n")}`
    : "";
  const corpo = `Lembretes de pagamento — vencem em ${amanha}\n\n${enviados} SMS enviado(s) de ${resultados.length} cobrança(s).\n\n${linhas}${seccaoAlertas}`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
        to: destinatario.split(",").map((e) => e.trim()).filter(Boolean),
        subject: `Lembretes de pagamento (${amanha}): ${enviados} enviado(s)`,
        text: corpo,
      }),
    });
  } catch (e) {
    console.error("[lembretes] falha no resumo por email:", e);
  }
}
