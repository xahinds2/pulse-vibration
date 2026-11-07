export const dynamicParams = false;

export function generateStaticParams() {
  return ["patterns", "control", "users"].map(screen => ({ screen }));
}

export default function Page() {
  return null;
}
