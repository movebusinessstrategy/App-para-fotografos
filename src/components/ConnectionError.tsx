export default function ConnectionError({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-6 dark:bg-gray-950">
      <div role="alert" className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Não foi possível carregar sua conta</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-400">{message}</p>
        <button type="button" onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-gray-900 px-5 py-3 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 dark:bg-gray-100 dark:text-gray-900">
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
