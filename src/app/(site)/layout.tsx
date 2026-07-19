import Header from "@/components/Header";
import Footer from "@/components/Footer";

/**
 * Layout partilhado pelas páginas públicas. A administração fica de fora, com
 * o seu próprio cabeçalho — daí este route group.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const whatsappNumber =
    process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "351912345678";

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Header whatsappNumber={whatsappNumber} />
      <div className="flex-1">{children}</div>
      <Footer whatsappNumber={whatsappNumber} />
    </div>
  );
}
