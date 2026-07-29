import { requireAdmin } from "@/lib/dal";
import { regrasAtivas } from "@/actions/regrasActions";
import { REGRAS_RASCUNHO } from "@/content/regrasDefault";
import RegrasEditor from "./RegrasEditor";

export default async function RegrasPage() {
  await requireAdmin();
  const [pt, en] = await Promise.all([regrasAtivas("pt"), regrasAtivas("en")]);
  return <RegrasEditor pt={pt} en={en} rascunho={REGRAS_RASCUNHO} />;
}
