export function StorePanel() {
  const estado = useAppStore();
  return <span>{estado.nombre}</span>;
}