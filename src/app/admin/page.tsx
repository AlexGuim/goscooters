import { redirect } from "next/navigation";

export default function AdminPage() {
  // O proxy trata de mandar para o login quem não tiver sessão.
  redirect("/admin/motas");
}
