export interface StoreErrorEntry {
  id: string;
  error: string | null;
}

interface Props {
  loadError: string | null;
  migrationError: string | null;
  retryDisabled: boolean;
  onRetryMigration: () => void;
  dictionaryError: string | null;
  persistenceErrors: readonly StoreErrorEntry[];
}

export function AppErrorBanners({
  loadError,
  migrationError,
  retryDisabled,
  onRetryMigration,
  dictionaryError,
  persistenceErrors,
}: Props) {
  return (
    <>
      {loadError && (
        <p className="error-banner" role="alert">
          {loadError}。再読み込みして再試行してください。
        </p>
      )}

      {migrationError && (
        <div className="error-banner" role="alert">
          <span>{migrationError}</span>{' '}
          <button
            type="button"
            className="btn btn-small"
            onClick={onRetryMigration}
            disabled={retryDisabled}
          >
            移行を再試行
          </button>
        </div>
      )}

      {dictionaryError && (
        <p className="error-banner" role="alert">
          {dictionaryError}
        </p>
      )}

      {persistenceErrors
        .filter((item): item is { id: string; error: string } => Boolean(item.error))
        .map((item) => (
          <p className="error-banner" role="alert" key={item.id}>
            {item.error}。再読み込みして再試行してください。
          </p>
        ))}
    </>
  );
}
