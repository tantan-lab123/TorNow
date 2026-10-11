import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-paper text-ink-900 flex flex-col items-center justify-center px-6 text-center">
      <LogoMark size={48} />
      <h1 className="mt-6 text-2xl font-extrabold">העמוד לא נמצא</h1>
      <p className="mt-2 max-w-sm text-ink-600 leading-relaxed">
        ייתכן שהקישור שגוי או שהעסק שינה את הכתובת שלו. כדאי לבדוק את הקישור מול העסק.
      </p>
      <Link
        href="/"
        className="m-key mt-8 inline-flex items-center justify-center h-12 px-6 rounded-lg bg-brand-600 text-white font-bold"
      >
        לדף הבית של Torli
      </Link>
    </main>
  );
}
