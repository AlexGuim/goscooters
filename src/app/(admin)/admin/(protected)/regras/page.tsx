import { requireAdmin } from "@/lib/dal";
import { regrasAtivas } from "@/actions/regrasActions";
import { REGRAS_RASCUNHO } from "@/content/regrasDefault";
import RegrasEditor from "./RegrasEditor";

export default async function RegrasPage() {
  await requireAdmin();
  const ativas = await regrasAtivas();
  return <RegrasEditor inicial={ativas} rascunho={REGRAS_RASCUNHO} />;
}
