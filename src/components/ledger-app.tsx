"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Download,
  Ellipsis,
  House,
  Info,
  List,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShoppingBag,
  ShoppingBasket,
  TrainFront,
  Utensils,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  STORAGE_KEY,
  assetTransactions,
  categoryInfo,
  categoryLabelKey,
  categoryOptions,
  convertedMinor,
  currencyFlag,
  currencyName,
  fractionDigits,
  insertDecimalPoint,
  isManagement,
  money,
  monthKey,
  normalizeDecimalInput,
  parseAmount,
  parseLedger,
  shiftMonth,
  today,
  totals,
  validSnapshot,
  type Asset,
  type Category,
  type CustomCategory,
  type Ledger,
  type RateSnapshot,
  type Transaction,
} from "@/lib/ledger";
import {
  mergeLocalLedger,
  MIGRATION_KEY,
  parseLedgerState,
  type LedgerState,
} from "@/lib/ledger-sync";
import {
  livingBudget,
  periodTransactions,
  reportingTransactions,
  type PeriodMode,
} from "@/lib/ledger-analytics";
import LedgerCharts from "./ledger-charts";

type Tab = "home" | "transactions" | "assets" | "settings";
const navigation: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "홈", icon: House },
  { id: "transactions", label: "내역", icon: List },
  { id: "assets", label: "자산", icon: Wallet },
  { id: "settings", label: "설정", icon: Settings2 },
];
const categoryIcons: Record<string, LucideIcon> = {
  utensils: Utensils,
  basket: ShoppingBasket,
  train: TrainFront,
  bag: ShoppingBag,
  home: House,
  coffee: Coffee,
  wallet: Wallet,
  dots: Ellipsis,
};

async function fetchRates(signal?: AbortSignal): Promise<RateSnapshot> {
  const response = await fetch("/api/rates", { cache: "no-store", signal });
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("다시 접속해 주세요.");
  }
  const value: unknown = await response.json();
  if (!response.ok || !validSnapshot(value))
    throw new Error(
      "환율을 불러오지 못했어요. 다시 시도하거나 직접 입력해 주세요.",
    );
  return value;
}

function download(value: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([value], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Modal({
  children,
  close,
  title,
  className = "",
}: {
  children: ReactNode;
  close: () => void;
  title: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="닫기">
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function CategoryIcon({
  category,
  customCategories,
}: {
  category: Category;
  customCategories: CustomCategory[];
}) {
  const data = categoryInfo(category, customCategories);
  const Icon = categoryIcons[data.icon];
  return (
    <span className={`category-icon category-${category}`}>
      <Icon size={20} strokeWidth={1.7} />
    </span>
  );
}

function CategoryCreator({
  onAdd,
  close,
}: {
  onAdd: (label: string) => Promise<string>;
  close: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const add = async () => {
    setSaving(true);
    setError("");
    try {
      await onAdd(name);
      close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "카테고리를 추가하지 못했어요.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="category-creator">
      <label className="form-field">
        새 카테고리 이름
        <input
          value={name}
          maxLength={30}
          placeholder="예: 건강, 여행, 반려동물"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!saving && name.trim()) void add();
            }
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="category-creator-actions">
        <button
          type="button"
          className="button button-soft"
          disabled={saving}
          onClick={close}
        >
          취소
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={saving || !name.trim()}
          onClick={() => void add()}
        >
          {saving ? "추가 중…" : "추가하기"}
        </button>
      </div>
    </div>
  );
}

function AssetEditor({
  asset,
  canDelete,
  onSave,
  remove,
  close,
}: {
  asset: Asset | null;
  canDelete: boolean;
  onSave: (label: string) => Promise<void>;
  remove: () => Promise<void>;
  close: () => void;
}) {
  const [name, setName] = useState(asset?.label ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const persist = async (deleting = false) => {
    setSaving(true);
    setError("");
    try {
      if (deleting) await remove();
      else await onSave(name.trim());
      close();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "자산을 저장하지 못했어요.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={asset ? "자산 관리" : "자산 추가"}
      close={() => {
        if (!saving) close();
      }}
    >
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void persist();
        }}
      >
        <label className="form-field">
          자산 이름
          <input
            autoFocus
            required
            maxLength={30}
            placeholder="예: 생활비 통장, 현금, 저축"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button button-primary full-width"
          disabled={saving || !name.trim()}
        >
          {saving ? "저장 중…" : asset ? "이름 변경" : "추가하기"}
        </button>
        {asset && (
          <>
            <button
              type="button"
              className="button button-soft full-width"
              disabled={saving || !canDelete}
              onClick={() => void persist(true)}
            >
              자산 삭제
            </button>
            <p className="footnote">
              거래가 없는 자산만 삭제할 수 있어요. 자산은 최소 하나가 필요해요.
            </p>
          </>
        )}
      </form>
    </Modal>
  );
}

function TransactionEditor({
  transaction,
  currencies,
  assets,
  initialAssetId,
  initialCategory,
  customCategories,
  onAddCategory,
  onSave,
  close,
}: {
  transaction: Transaction | null;
  currencies: string[];
  assets: Asset[];
  initialAssetId: string;
  initialCategory: Category;
  customCategories: CustomCategory[];
  onAddCategory: (label: string) => Promise<string>;
  onSave: (transaction: Transaction) => Promise<void>;
  close: () => void;
}) {
  const [type, setType] = useState<Transaction["type"]>(
    transaction?.type ??
      (initialCategory === "management" ? "income" : "expense"),
  );
  const [assetId, setAssetId] = useState(
    transaction?.assetId ?? (initialAssetId || assets[0].id),
  );
  const [toAssetId, setToAssetId] = useState(
    transaction?.toAssetId ??
      assets.find(
        (asset) =>
          asset.id !== (transaction?.assetId || initialAssetId || assets[0].id),
      )?.id ??
      "",
  );
  const [currency, setCurrency] = useState(transaction?.currency ?? "DKK");
  const [amount, setAmount] = useState(
    transaction
      ? String(
          transaction.amountMinor / 10 ** fractionDigits(transaction.currency),
        )
      : "",
  );
  const amountInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(transaction?.title ?? "");
  const [category, setCategory] = useState<Category>(
    transaction?.type === "transfer"
      ? "food"
      : (transaction?.category ?? initialCategory),
  );
  const [date, setDate] = useState(transaction?.date ?? today());
  const [note, setNote] = useState(transaction?.note ?? "");
  const [snapshot, setSnapshot] = useState<RateSnapshot | null>(
    transaction?.fx ?? null,
  );
  const [loading, setLoading] = useState(!transaction);
  const [saving, setSaving] = useState(false);
  const [rateError, setRateError] = useState("");
  const [error, setError] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualRate, setManualRate] = useState("");
  const [draftId] = useState(
    () =>
      transaction?.id ??
      (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("")),
  );
  const draftCreatedAt = useRef(transaction?.createdAt);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setRateError("");
    try {
      const fx = await fetchRates(signal);
      setSnapshot(fx);
    } catch {
      if (!signal?.aborted)
        setRateError(
          "자동 환율을 불러오지 못했어요. 다시 시도하거나 직접 입력해 주세요.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (transaction) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, transaction]);
  const rate =
    currency === "DKK"
      ? 1
      : manual
        ? Number(manualRate)
        : snapshot?.rates[currency]
          ? 1 / snapshot.rates[currency]
          : null;
  const amountMinor = parseAmount(amount, currency);
  const dkk =
    amountMinor && rate
      ? Math.round((amountMinor / 10 ** fractionDigits(currency)) * rate * 100)
      : null;

  function addAmountDecimal() {
    const input = amountInput.current;
    if (!input) return;
    const next = insertDecimalPoint(
      amount,
      input.selectionStart ?? amount.length,
      input.selectionEnd ?? amount.length,
    );
    setAmount(next.value);
    input.focus();
    requestAnimationFrame(() =>
      input.setSelectionRange(next.caret, next.caret),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!assets.some((asset) => asset.id === assetId)) {
      setError("자산을 선택해 주세요.");
      return;
    }
    if (
      type === "transfer" &&
      (!assets.some((asset) => asset.id === toAssetId) || assetId === toAssetId)
    ) {
      setError("서로 다른 보내는 자산과 받는 자산을 선택해 주세요.");
      return;
    }
    if (!amountMinor) {
      setError(
        `금액을 확인해 주세요. ${currency}는 소수점 ${fractionDigits(currency)}자리까지 입력할 수 있어요.`,
      );
      return;
    }
    if (!title.trim() && type !== "transfer") {
      setError("거래 이름을 입력해 주세요.");
      return;
    }
    if (
      !date ||
      date > today() ||
      new Date(date).toISOString().slice(0, 10) !== date
    ) {
      setError("오늘 또는 이전의 거래 날짜를 선택해 주세요.");
      return;
    }
    if (
      manual &&
      currency !== "DKK" &&
      (!Number.isFinite(Number(manualRate)) || Number(manualRate) <= 0)
    ) {
      setError("0보다 큰 환율을 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      let fx = snapshot;
      if (!transaction && !manual) fx = await fetchRates();
      if (manual) {
        const now = new Date().toISOString();
        fx = {
          ...(fx ?? {
            base: "DKK",
            rates: { DKK: 1 },
            dates: { DKK: today() },
            fetchedAt: now,
          }),
          rates: {
            ...(fx?.rates ?? { DKK: 1 }),
            [currency]: currency === "DKK" ? 1 : 1 / Number(manualRate),
          },
          dates: { ...(fx?.dates ?? { DKK: today() }), [currency]: today() },
          fetchedAt: now,
          source: "manual",
        };
      }
      if (!fx || !fx.rates[currency] || !validSnapshot(fx))
        throw new Error(
          "선택한 통화의 환율이 없어요. 환율을 직접 입력해 주세요.",
        );
      const result: Transaction = {
        id: draftId,
        assetId,
        type,
        ...(type === "transfer" ? { toAssetId } : {}),
        title: title.trim() || "자산 간 이체",
        amountMinor,
        currency,
        category: type === "transfer" ? "management" : category,
        date,
        note: note.trim(),
        createdAt: (draftCreatedAt.current ??= new Date().toISOString()),
        fx: structuredClone(fx),
      };
      await onSave(result);
      close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "저장하지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={transaction ? "내역 수정" : "내역 추가"}
      close={() => {
        if (!saving) close();
      }}
      className="editor-modal"
    >
      <form id="transaction-form" className="editor-form" onSubmit={submit}>
        <div className="type-switch" aria-label="내역 유형 선택">
          <button
            type="button"
            className={type === "expense" ? "selected" : ""}
            aria-pressed={type === "expense"}
            onClick={() => setType("expense")}
          >
            <ArrowUpRight size={17} />
            {category === "management" ? "잔액 차감" : "지출"}
          </button>
          <button
            type="button"
            className={type === "income" ? "selected" : ""}
            aria-pressed={type === "income"}
            onClick={() => setType("income")}
          >
            <ArrowDownLeft size={17} />
            {category === "management" ? "잔액 추가" : "수입"}
          </button>
          <button
            type="button"
            className={type === "transfer" ? "selected" : ""}
            aria-pressed={type === "transfer"}
            onClick={() => {
              setType("transfer");
              setAddingCategory(false);
            }}
          >
            <ArrowRightLeft size={17} /> 이체
          </button>
        </div>
        {type === "transfer" && (
          <p className="section-description">
            선택한 통화의 금액을 보내는 자산에서 빼고 받는 자산에 더해요.
            수입·지출 합계와 그래프에는 포함하지 않아요.
          </p>
        )}
        <div className="amount-label-row">
          <label className="field-label" htmlFor="amount">
            금액
          </label>
          {fractionDigits(currency) > 0 && (
            <button
              type="button"
              className="decimal-button"
              aria-label="금액에 소수점 입력"
              disabled={saving}
              onPointerDown={(event) => event.preventDefault()}
              onClick={addAmountDecimal}
            >
              <strong aria-hidden="true">.</strong> 소수점
            </button>
          )}
        </div>
        <div className="amount-field">
          <input
            id="amount"
            ref={amountInput}
            type="text"
            autoFocus
            inputMode={fractionDigits(currency) > 0 ? "decimal" : "numeric"}
            placeholder="0"
            value={amount}
            onChange={(event) =>
              setAmount(normalizeDecimalInput(event.target.value))
            }
            autoComplete="off"
            required
          />
          <select
            aria-label="거래 통화"
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
              setManualRate("");
            }}
          >
            {[
              ...new Set([
                ...currencies,
                ...(transaction ? [transaction.currency] : []),
              ]),
            ].map((code) => (
              <option key={code} value={code}>
                {currencyFlag(code)} {code}
              </option>
            ))}
          </select>
        </div>
        {currency !== "DKK" && (
          <div className="conversion-preview">
            {dkk !== null
              ? `≈ ${money(dkk, "DKK")} DKK`
              : "환율을 확인하면 DKK 환산 금액이 표시돼요"}
          </div>
        )}
        <label className="form-field">
          {type === "transfer" ? "보내는 자산" : "자산"}
          <select
            value={assetId}
            onChange={(event) => {
              setAssetId(event.target.value);
              if (event.target.value === toAssetId) setToAssetId("");
            }}
          >
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.label}
              </option>
            ))}
          </select>
        </label>
        {type === "transfer" && (
          <label className="form-field">
            받는 자산
            <select
              value={toAssetId}
              onChange={(event) => setToAssetId(event.target.value)}
              required
            >
              <option value="">받는 자산 선택</option>
              {assets
                .filter((asset) => asset.id !== assetId)
                .map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
            </select>
          </label>
        )}
        {type === "transfer" && assets.length < 2 && (
          <p className="footnote">
            자산 탭에서 자산을 하나 더 추가한 뒤 이체할 수 있어요.
          </p>
        )}
        <label className="form-field">
          내용
          {type === "transfer" && <span className="optional">선택</span>}
          <input
            placeholder={type === "transfer" ? "자산 간 이체" : "예: 점심 식사"}
            maxLength={80}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required={type !== "transfer"}
          />
        </label>
        <div className="form-grid">
          {type !== "transfer" && (
            <label className="form-field">
              카테고리
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as Category)
                }
              >
                {categoryOptions(customCategories).map((data) => (
                  <option key={data.id} value={data.id}>
                    {data.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type !== "transfer" && category === "management" && (
            <p className="footnote">
              선택한 자산의 잔액에 반영해요. 수입·지출 합계와 그래프에서는
              제외돼요.
            </p>
          )}
          {type !== "transfer" &&
            (addingCategory ? (
              <CategoryCreator
                onAdd={async (name) => {
                  const id = await onAddCategory(name);
                  setCategory(id);
                  return id;
                }}
                close={() => setAddingCategory(false)}
              />
            ) : (
              <button
                className="text-button add-category-button"
                type="button"
                onClick={() => setAddingCategory(true)}
              >
                <Plus size={18} /> 카테고리 추가
              </button>
            ))}
          <label className="form-field">
            거래 날짜
            <input
              type="date"
              value={date}
              max={today()}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
        </div>
        <label className="form-field">
          메모 <span className="optional">선택</span>
          <input
            placeholder="메모 입력"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <details className="rate-notice" open={manual || Boolean(rateError)}>
          <summary>
            적용 환율 <ChevronDown size={17} />
          </summary>
          <div className="rate-notice-heading">
            <span>
              <LockKeyhole size={14} />
              {transaction ? "등록 당시 환율 유지" : "등록 시점의 환율로 저장"}
            </span>
            {!transaction && (
              <button type="button" onClick={() => setManual(!manual)}>
                {manual ? "자동 조회" : "직접 입력"}
              </button>
            )}
          </div>
          {manual ? (
            <>
              <label className="manual-rate">
                1 {currency} ={" "}
                <input
                  aria-label={`1 ${currency}에 대한 DKK 환율`}
                  type="number"
                  inputMode="decimal"
                  min="0.000000001"
                  step="any"
                  placeholder="환율 입력"
                  value={currency === "DKK" ? "1" : manualRate}
                  disabled={currency === "DKK"}
                  onChange={(event) => setManualRate(event.target.value)}
                  required
                />{" "}
                DKK
              </label>
              <p>
                직접 입력한 환율이 보관돼요. 자동 조회에 실패한 경우 다른 통화의
                합계는 환율이 없어 표시되지 않을 수 있어요.
              </p>
            </>
          ) : (
            <>
              <p>
                {loading
                  ? "최신 고시환율을 확인하고 있어요…"
                  : rateError ||
                    (rate
                      ? `1 ${currency} = ${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(rate)} DKK · 고시일 ${snapshot?.dates[currency] ?? today()}`
                      : "이 통화는 자동 환율이 없어요. 직접 입력해 주세요.")}
              </p>
              {rateError && !transaction && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void load()}
                >
                  <RefreshCw size={13} />
                  다시 시도
                </button>
              )}
              <p>
                거래 날짜와 관계없이 등록 시점의 최신 일별 고시값을 저장해요.
              </p>
            </>
          )}
        </details>
      </form>
      <div className="editor-footer">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button button-primary full-width"
          disabled={
            saving ||
            addingCategory ||
            (loading && !manual) ||
            (type === "transfer" && assets.length < 2)
          }
          type="submit"
          form="transaction-form"
        >
          {saving ? "저장 중…" : transaction ? "수정하기" : "저장하기"}
        </button>
      </div>
    </Modal>
  );
}

function TransactionRows({
  transactions,
  currency,
  customCategories,
  assets,
  assetId = "",
  onSelect,
  emptyText = "아직 내역이 없어요",
}: {
  transactions: Transaction[];
  currency: string;
  customCategories: CustomCategory[];
  assets: Asset[];
  assetId?: string;
  onSelect: (transaction: Transaction) => void;
  emptyText?: string;
}) {
  if (!transactions.length) return <p className="empty-state">{emptyText}</p>;
  return (
    <div className="transaction-list">
      {transactions.map((transaction) => {
        const converted = convertedMinor(transaction, currency);
        const transfer = transaction.type === "transfer";
        const incoming =
          transaction.type === "income" ||
          (transfer && transaction.toAssetId === assetId);
        return (
          <button
            className="transaction-row"
            key={transaction.id}
            onClick={() => onSelect(transaction)}
          >
            {transfer ? (
              <span className="category-icon">
                <ArrowRightLeft size={20} />
              </span>
            ) : (
              <CategoryIcon
                category={transaction.category}
                customCategories={customCategories}
              />
            )}
            <span className="transaction-info">
              <strong>{transaction.title}</strong>
              <span>
                {Number(transaction.date.slice(5, 7))}.
                {transaction.date.slice(8)} ·{" "}
                {transfer
                  ? "이체"
                  : categoryInfo(transaction.category, customCategories).label}
                {" · "}
                {
                  assets.find((asset) => asset.id === transaction.assetId)
                    ?.label
                }
                {transfer && (
                  <>
                    {" "}
                    →{" "}
                    {
                      assets.find((asset) => asset.id === transaction.toAssetId)
                        ?.label
                    }
                  </>
                )}
              </span>
            </span>
            <span
              className={`transaction-amount ${incoming ? "income-text" : ""}`}
            >
              <strong>
                {transfer && !assetId ? "↔" : incoming ? "+" : "−"}
                {money(transaction.amountMinor, transaction.currency)}
                <small>{transaction.currency}</small>
              </strong>
              {transaction.currency !== currency && (
                <span>
                  {converted === null
                    ? "환산 환율 없음"
                    : `≈ ${money(converted, currency)} ${currency}`}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TransactionDetail({
  transaction,
  currency,
  customCategories,
  assets,
  close,
  edit,
  remove,
}: {
  transaction: Transaction;
  currency: string;
  customCategories: CustomCategory[];
  assets: Asset[];
  close: () => void;
  edit: () => void;
  remove: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const converted = convertedMinor(transaction, currency);
  const [removing, setRemoving] = useState(false);
  return (
    <Modal
      title="상세 내역"
      close={() => {
        if (!removing) close();
      }}
    >
      <div className="detail-hero">
        <span>{transaction.title}</span>
        <strong className={transaction.type === "income" ? "income-text" : ""}>
          {transaction.type === "transfer"
            ? "↔"
            : transaction.type === "income"
              ? "+"
              : "−"}
          {money(transaction.amountMinor, transaction.currency)}
          <small>{transaction.currency}</small>
        </strong>
        {transaction.currency !== currency && (
          <p>
            {converted === null
              ? `${currency} 환산 환율 없음`
              : `≈ ${money(converted, currency)} ${currency}`}
          </p>
        )}
      </div>
      <dl className="detail-list">
        <div>
          <dt>{transaction.type === "transfer" ? "보내는 자산" : "자산"}</dt>
          <dd>
            {assets.find((asset) => asset.id === transaction.assetId)?.label}
          </dd>
        </div>
        {transaction.type === "transfer" && (
          <div>
            <dt>받는 자산</dt>
            <dd>
              {
                assets.find((asset) => asset.id === transaction.toAssetId)
                  ?.label
              }
            </dd>
          </div>
        )}
        <div>
          <dt>유형</dt>
          <dd>
            {transaction.type === "transfer"
              ? "이체"
              : isManagement(transaction)
                ? transaction.type === "income"
                  ? "잔액 추가"
                  : "잔액 차감"
                : transaction.type === "income"
                  ? "수입"
                  : "지출"}
          </dd>
        </div>
        {transaction.type !== "transfer" && (
          <div>
            <dt>카테고리</dt>
            <dd>
              {categoryInfo(transaction.category, customCategories).label}
            </dd>
          </div>
        )}
        <div>
          <dt>날짜</dt>
          <dd>{transaction.date}</dd>
        </div>
        {transaction.note && (
          <div>
            <dt>메모</dt>
            <dd>{transaction.note}</dd>
          </div>
        )}
      </dl>
      {isManagement(transaction) && (
        <p className="footnote">
          선택한 자산의 잔액에 반영되는 관리항목이에요.
        </p>
      )}
      {transaction.type === "transfer" && (
        <p className="footnote">
          이체를 수정하거나 삭제하면 양쪽 자산의 잔액에 함께 반영돼요. 수입·지출
          합계에는 포함하지 않아요.
        </p>
      )}
      <details className="rate-notice">
        <summary>
          저장된 환율 <ChevronDown size={17} />
        </summary>
        <p>
          1 {transaction.currency} ={" "}
          {new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(
            1 / transaction.fx.rates[transaction.currency],
          )}{" "}
          DKK
        </p>
        <p>
          {transaction.fx.source === "manual"
            ? "직접 입력"
            : transaction.fx.source === "demo"
              ? "예시"
              : "Frankfurter"}{" "}
          · 고시일 {transaction.fx.dates[transaction.currency]}
        </p>
        <p>등록 {new Date(transaction.createdAt).toLocaleString("ko-KR")}</p>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {confirmDelete ? (
        <div className="delete-confirm">
          <p>이 내역을 삭제할까요?</p>
          <span>삭제한 내역은 복구할 수 없어요.</span>
          <div>
            <button
              className="button button-soft"
              disabled={removing}
              onClick={() => setConfirmDelete(false)}
            >
              취소
            </button>
            <button
              className="button button-danger"
              disabled={removing}
              onClick={async () => {
                setRemoving(true);
                setError("");
                try {
                  await remove();
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "삭제하지 못했어요. 다시 시도해 주세요.",
                  );
                } finally {
                  setRemoving(false);
                }
              }}
            >
              {removing ? "삭제 중…" : "삭제하기"}
            </button>
          </div>
        </div>
      ) : (
        <div className="detail-actions">
          <button className="button button-soft" onClick={edit}>
            수정하기
          </button>
          <button
            className="button delete-button"
            onClick={() => setConfirmDelete(true)}
          >
            삭제
          </button>
        </div>
      )}
    </Modal>
  );
}

function Settings({
  ledger,
  commit,
  rates,
  refresh,
  rateLoading,
  rateError,
  backup,
  logout,
  loggingOut,
  saving,
  onAddCategory,
}: {
  ledger: Ledger;
  commit: (ledger: Ledger) => Promise<void>;
  rates: RateSnapshot | null;
  refresh: () => void;
  rateLoading: boolean;
  rateError: string;
  backup: () => void;
  logout: () => void;
  loggingOut: boolean;
  saving: boolean;
  onAddCategory: (label: string) => Promise<string>;
}) {
  const [adding, setAdding] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const available = Intl.supportedValuesOf("currency").filter(
    (code) =>
      !ledger.currencies.includes(code) &&
      `${code} ${currencyName(code)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="settings-page">
      <h1>설정</h1>
      {!adding && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="settings-section">
        <div className="section-heading">
          <h2>카테고리</h2>
          {!addingCategory && (
            <button
              className="text-button"
              disabled={saving}
              onClick={() => setAddingCategory(true)}
            >
              <Plus size={18} /> 추가
            </button>
          )}
        </div>
        <p className="section-description">
          추가한 카테고리는 수입·지출 모두에 사용할 수 있어요.
        </p>
        <div className="category-tags">
          {categoryOptions(ledger.customCategories).map((category) => (
            <span key={category.id}>{category.label}</span>
          ))}
        </div>
        <p className="footnote">
          관리항목은 전체 잔액에만 반영해요. 수입·지출 합계와 그래프에서는
          제외돼요.
        </p>
        {addingCategory && (
          <CategoryCreator
            onAdd={onAddCategory}
            close={() => setAddingCategory(false)}
          />
        )}
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <h2>통화별 잔액</h2>
          <button className="text-button" onClick={() => setAdding(true)}>
            <Plus size={18} />
            통화 추가
          </button>
        </div>
        <p className="section-description">
          전체 기간 · 관리항목 포함 · 등록 당시 환율 기준
        </p>
        <div className="currency-list">
          {ledger.currencies.map((code) => {
            const aggregate = totals(ledger.transactions, code);
            return (
              <div className="currency-row" key={code}>
                <div className="currency-label">
                  <strong>
                    {code}
                    {code === "DKK" && <span className="tag">기본</span>}
                  </strong>
                  <span>{currencyName(code)}</span>
                </div>
                <div className="currency-total">
                  <strong>
                    {aggregate.missing > 0 &&
                    aggregate.missing === ledger.transactions.length
                      ? "—"
                      : money(aggregate.balance, code)}
                  </strong>
                  {aggregate.missing > 0 && (
                    <small>{aggregate.missing}건 환산 불가</small>
                  )}
                </div>
                {code !== "DKK" ? (
                  <button
                    className="icon-button"
                    disabled={saving}
                    aria-label={`${code} 통화 제거`}
                    onClick={async () => {
                      setError("");
                      try {
                        await commit({
                          ...ledger,
                          currencies: ledger.currencies.filter(
                            (item) => item !== code,
                          ),
                          displayCurrency:
                            ledger.displayCurrency === code
                              ? "DKK"
                              : ledger.displayCurrency,
                        });
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "저장하지 못했어요.",
                        );
                      }
                    }}
                  >
                    <X size={18} />
                  </button>
                ) : (
                  <span className="currency-lock">
                    <LockKeyhole size={17} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="footnote">통화를 제거해도 기존 거래 내역은 남아요.</p>
      </section>
      <section className="settings-section">
        <details className="reference-rates">
          <summary>
            현재 참고 환율
            <ChevronDown size={19} />
          </summary>
          <div className="rate-toolbar">
            <span>1 DKK 기준</span>
            <button
              className="icon-button"
              onClick={refresh}
              disabled={rateLoading}
              aria-label="환율 새로고침"
            >
              <RefreshCw
                size={18}
                className={rateLoading ? "is-loading" : ""}
              />
            </button>
          </div>
          {rateError && (
            <p className="form-error" role="alert">
              {rateError}
            </p>
          )}
          {ledger.currencies
            .filter((code) => code !== "DKK")
            .map((code) => (
              <div className="reference-rate" key={code}>
                <span>{code}</span>
                <strong>
                  {rates?.rates[code]
                    ? new Intl.NumberFormat("ko-KR", {
                        maximumFractionDigits: 4,
                      }).format(rates.rates[code])
                    : "—"}
                </strong>
                <small>{rates?.dates[code] ?? "환율 없음"}</small>
              </div>
            ))}
          <p className="footnote">
            참고용 최신 고시값이에요. 기존 거래에는 저장된 환율을 적용해요.
          </p>
        </details>
      </section>
      <section className="settings-section">
        <h2>데이터</h2>
        <button className="settings-action" onClick={backup}>
          <Download size={21} />
          내역 백업
          <ChevronRight size={20} />
        </button>
        <p className="footnote">
          내역은 서버에 저장돼요. 같은 비밀번호로 접속한 기기에서 함께 볼 수
          있어요.
        </p>
      </section>
      <section className="settings-section">
        <button
          className="settings-action"
          onClick={logout}
          disabled={loggingOut}
        >
          <LogOut size={21} />
          {loggingOut ? "잠그는 중…" : "가계부 잠그기"}
          <ChevronRight size={20} />
        </button>
      </section>
      {adding && (
        <Modal
          title="통화 추가"
          close={() => {
            setAdding(false);
            setQuery("");
            setError("");
          }}
        >
          <label className="search-field">
            <Search size={21} />
            <input
              autoFocus
              aria-label="통화 검색"
              placeholder="통화 이름 또는 코드 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="currency-options">
            {available.length ? (
              available.map((code) => (
                <button
                  disabled={saving}
                  key={code}
                  onClick={async () => {
                    setError("");
                    try {
                      await commit({
                        ...ledger,
                        currencies: [...ledger.currencies, code],
                      });
                      setAdding(false);
                      setQuery("");
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "저장하지 못했어요.",
                      );
                    }
                  }}
                >
                  <span>
                    <strong>{code}</strong>
                    <small>{currencyName(code)}</small>
                  </span>
                  <Plus size={21} />
                </button>
              ))
            ) : (
              <p className="empty-state">검색 결과가 없어요</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

async function loadRemoteLedger(signal?: AbortSignal): Promise<LedgerState> {
  const response = await fetch("/api/ledger", { cache: "no-store", signal });
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("다시 접속해 주세요.");
  }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "내역을 불러오지 못했어요.");
  return parseLedgerState(value);
}

export default function LedgerApp() {
  const [remote, setRemote] = useState<LedgerState | null>(null);
  const remoteRef = useRef<LedgerState | null>(null);
  const busy = useRef(false);
  const requestSequence = useRef(0);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [localLedger, setLocalLedger] = useState<Ledger | null>(null);
  const [migrationError, setMigrationError] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [month, setMonth] = useState(monthKey);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState("");
  const [assetEditor, setAssetEditor] = useState<Asset | null | undefined>();
  const [editorCategory, setEditorCategory] = useState<Category>("food");
  const [editor, setEditor] = useState<Transaction | null | undefined>();
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [showBudgetInfo, setShowBudgetInfo] = useState(false);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [rates, setRates] = useState<RateSnapshot | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const ledger = remote?.ledger ?? null;
  const activeAssetId = ledger?.assets.some(
    (asset) => asset.id === selectedAsset,
  )
    ? selectedAsset
    : "";
  const refresh = useCallback(async () => {
    setRateLoading(true);
    setRateError("");
    try {
      setRates(await fetchRates());
    } catch {
      setRateError("환율을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setRateLoading(false);
    }
  }, []);
  const reloadLedger = useCallback(async (signal?: AbortSignal) => {
    if (!signal && busy.current) return;
    const sequence = ++requestSequence.current;
    busy.current = true;
    setSaving(true);
    setLoadError("");
    try {
      const state = await loadRemoteLedger(signal);
      if (!signal?.aborted && sequence === requestSequence.current) {
        remoteRef.current = state;
        setRemote(state);
      }
    } catch (cause) {
      if (!signal?.aborted && sequence === requestSequence.current)
        setLoadError(
          cause instanceof Error ? cause.message : "내역을 불러오지 못했어요.",
        );
    } finally {
      if (sequence === requestSequence.current) {
        busy.current = false;
        setSaving(false);
      }
    }
  }, []);
  useEffect(() => {
    try {
      if (!localStorage.getItem(MIGRATION_KEY)) {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const local = parseLedger(raw);
          if (local.transactions.length) setLocalLedger(local);
        }
      }
    } catch {
      setMigrationError(
        "이 기기의 기존 내역을 읽을 수 없어요. 원본을 백업해 주세요.",
      );
    }
    const controller = new AbortController();
    void reloadLedger(controller.signal);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      controller.abort();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [reloadLedger]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const commit = async (value: Ledger): Promise<void> => {
    if (busy.current || !remoteRef.current)
      throw new Error("저장 중이에요. 잠시 후 다시 시도해 주세요.");
    busy.current = true;
    setSaving(true);
    try {
      const validated = parseLedger(JSON.stringify(value));
      const response = await fetch("/api/ledger", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ledger: validated,
          revision: remoteRef.current.revision,
        }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        throw new Error("다시 접속해 주세요.");
      }
      const result = await response.json();
      if (response.status === 409) {
        const latest = await loadRemoteLedger();
        remoteRef.current = latest;
        setRemote(latest);
      }
      if (!response.ok)
        throw new Error(
          result.error || "저장하지 못했어요. 다시 시도해 주세요.",
        );
      const confirmed = parseLedgerState(result);
      remoteRef.current = confirmed;
      setRemote(confirmed);
      setLoadError("");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const scopedTransactions = useMemo(
    () => assetTransactions(ledger?.transactions ?? [], activeAssetId),
    [ledger, activeAssetId],
  );
  const period = useMemo(
    () => periodTransactions(scopedTransactions, month, periodMode),
    [scopedTransactions, month, periodMode],
  );
  if (!ledger)
    return (
      <main className="loading-screen">
        <strong>denlife</strong>
        <p>{loadError || "내역을 불러오는 중…"}</p>
        {loadError && (
          <button
            className="button button-primary"
            disabled={saving}
            onClick={() => void reloadLedger()}
          >
            다시 시도
          </button>
        )}
      </main>
    );
  const currency = ledger.displayCurrency;
  const summaryPeriod = periodTransactions(
    reportingTransactions(scopedTransactions, activeAssetId),
    month,
    periodMode,
  );
  const summary = totals(summaryPeriod, currency, activeAssetId);
  const overall = totals(scopedTransactions, currency, activeAssetId);
  const currentDate = today();
  const budgetAsOf =
    periodMode === "year"
      ? month.slice(0, 4) === currentDate.slice(0, 4)
        ? currentDate
        : `${month.slice(0, 4)}-12-31`
      : month === currentDate.slice(0, 7)
        ? currentDate
        : `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}`;
  const budget = livingBudget(
    scopedTransactions,
    currency,
    budgetAsOf,
    activeAssetId,
    periodMode === "year" ? month.slice(0, 4) : month,
  );
  const matches = (item: Transaction) =>
    (!selectedCategories.length ||
      (item.type !== "transfer" &&
        selectedCategories.includes(item.category))) &&
    [
      item.title,
      item.note,
      item.currency,
      item.type === "transfer"
        ? "이체"
        : categoryInfo(item.category, ledger.customCategories).label,
      ...ledger.assets
        .filter(
          (asset) => asset.id === item.assetId || asset.id === item.toAssetId,
        )
        .map((asset) => asset.label),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase());
  const matching = period.filter(matches);
  const filtered = matching.filter(
    (item) =>
      filter === "all" ||
      (filter === "management"
        ? isManagement(item)
        : !isManagement(item) && item.type === filter),
  );
  const navigate = (next: Tab) => {
    setTab(next);
    if (next === "settings" && !rates && !rateLoading) void refresh();
    window.scrollTo({ top: 0 });
  };
  const openEditor = (category: Category = "food") => {
    setEditorCategory(category);
    setEditor(null);
  };
  const saveAsset = async (label: string) => {
    if (!label || label.length > 30)
      throw new Error("자산 이름을 1~30자로 입력해 주세요.");
    if (
      ledger.assets.some(
        (asset) =>
          asset.id !== assetEditor?.id &&
          categoryLabelKey(asset.label) === categoryLabelKey(label),
      )
    )
      throw new Error("이미 있는 자산 이름이에요.");
    const asset = {
      id:
        assetEditor?.id ??
        `asset-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      label,
    };
    await commit({
      ...ledger,
      assets: assetEditor
        ? ledger.assets.map((item) => (item.id === asset.id ? asset : item))
        : [...ledger.assets, asset],
    });
    setToast(assetEditor ? "자산 이름을 변경했어요" : "자산을 추가했어요");
  };
  const save = async (transaction: Transaction) => {
    const existing = ledger.transactions;
    const registered = existing.find((item) => item.id === transaction.id);
    if (registered)
      transaction = {
        ...transaction,
        fx: registered.fx,
        createdAt: registered.createdAt,
      };
    const transactions = existing.some((item) => item.id === transaction.id)
      ? existing.map((item) =>
          item.id === transaction.id ? transaction : item,
        )
      : [...existing, transaction];
    await commit({ ...ledger, transactions });
    setMonth(transaction.date.slice(0, 7));
    setToast(editor ? "수정했어요" : "저장했어요");
  };
  const addCategory = async (name: string) => {
    const label = name.trim();
    if (!label || label.length > 30)
      throw new Error("카테고리 이름을 1~30자로 입력해 주세요.");
    if (
      categoryOptions(ledger.customCategories).some(
        (item) => categoryLabelKey(item.label) === categoryLabelKey(label),
      )
    )
      throw new Error("이미 있는 카테고리 이름이에요.");
    const id = `custom-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    await commit({
      ...ledger,
      customCategories: [...ledger.customCategories, { id, label }],
    });
    setToast("카테고리를 추가했어요");
    return id;
  };
  const backup = async () => {
    try {
      const latest = await loadRemoteLedger();
      download(
        JSON.stringify(latest.ledger, null, 2),
        `denlife-backup-${today()}.json`,
      );
      setToast("백업 파일을 다운로드했어요");
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "백업하지 못했어요.");
    }
  };
  const backupLocal = () => {
    try {
      download(
        localStorage.getItem(STORAGE_KEY) ?? "",
        `denlife-local-backup-${today()}.json`,
      );
    } catch {
      setToast("브라우저 저장소 권한을 확인해 주세요.");
    }
  };
  const pendingLocalCount =
    localLedger?.transactions.filter(
      (item) =>
        !ledger.transactions.some((remoteItem) => remoteItem.id === item.id),
    ).length ?? 0;
  const migrateLocal = async () => {
    if (!localLedger) return;
    try {
      await commit(mergeLocalLedger(ledger, localLedger));
      setLocalLedger(null);
      try {
        localStorage.setItem(MIGRATION_KEY, "true");
      } catch {
        /* The original backup remains intact if the marker cannot be saved. */
      }
      setToast("기존 내역을 DB로 옮겼어요");
    } catch (cause) {
      setToast(
        cause instanceof Error ? cause.message : "기존 내역을 옮기지 못했어요.",
      );
    }
  };
  const logout = async () => {
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.replace("/login");
    } catch {
      setToast("잠그지 못했어요. 연결을 확인해 주세요.");
      setLoggingOut(false);
    }
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="wordmark"
          aria-label="denlife 홈"
          onClick={() => navigate("home")}
        >
          denlife
        </button>
        {tab !== "settings" && (
          <label className="currency-select">
            <span className="sr-only">합계 표시 통화</span>
            <select
              aria-label="합계 표시 통화"
              value={currency}
              disabled={saving}
              onChange={async (event) => {
                try {
                  await commit({
                    ...ledger,
                    displayCurrency: event.target.value,
                  });
                } catch (cause) {
                  setToast(
                    cause instanceof Error
                      ? cause.message
                      : "저장하지 못했어요.",
                  );
                }
              }}
            >
              {ledger.currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <ChevronDown size={17} />
          </label>
        )}
        <button
          className="icon-button"
          disabled={saving}
          onClick={() => void reloadLedger()}
          aria-label="내역 새로고침"
        >
          <RefreshCw size={20} className={saving ? "is-loading" : ""} />
        </button>
      </header>
      <main className="page-main">
        {loadError && (
          <p className="warning-banner" role="alert">
            {loadError}
          </p>
        )}
        {pendingLocalCount > 0 && (
          <div className="migration-banner">
            <p>이 기기에 저장된 내역 {pendingLocalCount}건이 있어요.</p>
            <span>기존 원본은 그대로 두고 DB에 추가해요.</span>
            <div>
              <button className="text-button" onClick={backupLocal}>
                원본 백업
              </button>
              <button
                className="button button-primary"
                disabled={saving}
                onClick={() => void migrateLocal()}
              >
                {saving ? "저장 중…" : "DB로 옮기기"}
              </button>
            </div>
          </div>
        )}
        {migrationError && (
          <div className="warning-banner">
            <p>{migrationError}</p>
            <button className="text-button" onClick={backupLocal}>
              원본 백업
            </button>
          </div>
        )}
        {(tab === "home" || tab === "transactions") && (
          <>
            <label className="form-field asset-filter">
              조회 자산
              <select
                value={activeAssetId}
                onChange={(event) => setSelectedAsset(event.target.value)}
              >
                <option value="">전체 자산</option>
                {ledger.assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="period-switch" aria-label="조회 기간">
              <button
                aria-pressed={periodMode === "month"}
                className={periodMode === "month" ? "selected" : ""}
                onClick={() => setPeriodMode("month")}
              >
                월별
              </button>
              <button
                aria-pressed={periodMode === "year"}
                className={periodMode === "year" ? "selected" : ""}
                onClick={() => setPeriodMode("year")}
              >
                연도별
              </button>
            </div>
            <div className="month-navigation">
              <button
                className="icon-button"
                aria-label={periodMode === "month" ? "이전 달" : "이전 연도"}
                onClick={() =>
                  setMonth(shiftMonth(month, periodMode === "month" ? -1 : -12))
                }
              >
                <ChevronLeft size={23} />
              </button>
              <label
                className={`month-picker ${periodMode === "year" ? "year-picker" : ""}`}
              >
                <span>
                  {Number(month.slice(0, 4))}년
                  {periodMode === "month" ? ` ${Number(month.slice(5))}월` : ""}
                </span>
                <ChevronDown size={18} />
                {periodMode === "year" ? (
                  <select
                    aria-label="조회 연도 선택"
                    value={month.slice(0, 4)}
                    onChange={(event) =>
                      setMonth(`${event.target.value}${month.slice(4)}`)
                    }
                  >
                    {[
                      ...new Set([
                        ...ledger.transactions.map((item) =>
                          Number(item.date.slice(0, 4)),
                        ),
                        Number(today().slice(0, 4)),
                        ...Array.from(
                          { length: 11 },
                          (_, index) => Number(month.slice(0, 4)) - 5 + index,
                        ),
                      ]),
                    ]
                      .filter((year) => year >= 1000 && year <= 9999)
                      .sort((a, b) => b - a)
                      .map((year) => (
                        <option key={year} value={year}>
                          {year}년
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    aria-label="조회 월 선택"
                    type="month"
                    min="1000-01"
                    max="9999-12"
                    value={month}
                    onChange={(event) => {
                      if (
                        /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value)
                      )
                        setMonth(event.target.value);
                    }}
                  />
                )}
              </label>
              <button
                className="icon-button"
                aria-label={periodMode === "month" ? "다음 달" : "다음 연도"}
                onClick={() =>
                  setMonth(shiftMonth(month, periodMode === "month" ? 1 : 12))
                }
              >
                <ChevronRight size={23} />
              </button>
            </div>
            {summary.missing > 0 && (
              <p className="warning-banner" role="status">
                환산 환율이 없는 {summary.missing}건은 합계에서 제외했어요.
              </p>
            )}
          </>
        )}
        {tab === "home" && (
          <>
            <section className="balance-section">
              <p className="balance-label">총 지출</p>
              <div className="balance-amount">
                {money(summary.expense, currency)}
                <span>{currency}</span>
              </div>
              <div className="summary-lines">
                <div>
                  <span>수입</span>
                  <strong className="income-text">
                    {money(summary.income, currency)}
                    <small>{currency}</small>
                  </strong>
                </div>
                <div>
                  <span className="summary-label">
                    생활비 잔액
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="생활비 잔액 계산 안내"
                      aria-haspopup="dialog"
                      onClick={() => setShowBudgetInfo(true)}
                    >
                      <Info size={18} aria-hidden="true" />
                    </button>
                  </span>
                  <strong>
                    {budget?.remaining != null
                      ? money(budget.remaining, currency)
                      : "—"}
                    {budget?.remaining != null && <small>{currency}</small>}
                  </strong>
                </div>
                <div>
                  <span>{activeAssetId ? "자산 잔액" : "전체 잔액"}</span>
                  <strong>
                    {money(overall.balance, currency)}
                    <small>{currency}</small>
                  </strong>
                </div>
              </div>
              <button
                className="button button-primary full-width"
                onClick={() => openEditor()}
              >
                <Plus size={21} />
                내역 추가
              </button>
            </section>
            <section className="recent-section">
              <div className="section-heading">
                <h2>최근 내역</h2>
                <button
                  className="text-button"
                  onClick={() => navigate("transactions")}
                >
                  전체 보기
                  <ChevronRight size={17} />
                </button>
              </div>
              <TransactionRows
                transactions={period.slice(0, 5)}
                currency={currency}
                customCategories={ledger.customCategories}
                assets={ledger.assets}
                assetId={activeAssetId}
                onSelect={setDetail}
              />
              <p className="footnote">
                합계는 각 거래의 등록 당시 환율로 계산해요.
              </p>
            </section>
          </>
        )}
        {tab === "transactions" && (
          <section className="all-transactions">
            <div className="section-heading">
              <h1>
                내역 <span className="count">{filtered.length}</span>
              </h1>
            </div>
            <label className="search-field">
              <Search size={20} />
              <input
                aria-label="내역 검색"
                placeholder="내용, 카테고리, 통화 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="filter-tabs" aria-label="내역 유형">
              {[
                ["all", "전체"],
                ["expense", "지출"],
                ["income", "수입"],
                ["transfer", "이체"],
                ["management", "관리항목"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "selected" : ""}
                  onClick={() => {
                    setFilter(value);
                    if (value === "transfer") setSelectedCategories([]);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {filter !== "transfer" && (
              <div className="category-chips" aria-label="카테고리 필터">
                <button
                  aria-pressed={!selectedCategories.length}
                  className={!selectedCategories.length ? "selected" : ""}
                  onClick={() => setSelectedCategories([])}
                >
                  모든 카테고리
                </button>
                {categoryOptions(ledger.customCategories).map((category) => (
                  <button
                    key={category.id}
                    aria-pressed={selectedCategories.includes(category.id)}
                    className={
                      selectedCategories.includes(category.id) ? "selected" : ""
                    }
                    onClick={() =>
                      setSelectedCategories((current) =>
                        current.includes(category.id)
                          ? current.filter((id) => id !== category.id)
                          : [...current, category.id],
                      )
                    }
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            )}
            {filter === "transfer" ? (
              <p className="footnote">
                자산 간 이체 내역이에요. 수입·지출 합계와 그래프에는 포함하지
                않아요.
              </p>
            ) : filter === "management" ? (
              <p className="footnote">
                관리항목은 전체 잔액에만 반영돼요. 수입·지출 합계와 그래프에서는
                제외돼요.
              </p>
            ) : (
              <LedgerCharts
                transactions={summaryPeriod.filter(matches)}
                currency={currency}
                customCategories={ledger.customCategories}
                month={month}
                mode={periodMode}
                breakdownType={filter === "income" ? "income" : "expense"}
              />
            )}
            <div className="section-heading transaction-results-heading">
              <h2>
                거래 내역 <span className="count">{filtered.length}</span>
              </h2>
            </div>
            <TransactionRows
              transactions={filtered}
              currency={currency}
              customCategories={ledger.customCategories}
              assets={ledger.assets}
              assetId={activeAssetId}
              onSelect={setDetail}
              emptyText={
                query || filter !== "all" || selectedCategories.length
                  ? "조건에 맞는 내역이 없어요"
                  : "아직 내역이 없어요"
              }
            />
          </section>
        )}
        {tab === "settings" && (
          <Settings
            ledger={ledger}
            commit={commit}
            rates={rates}
            refresh={() => void refresh()}
            rateLoading={rateLoading}
            rateError={rateError}
            backup={backup}
            logout={() => void logout()}
            loggingOut={loggingOut}
            saving={saving}
            onAddCategory={addCategory}
          />
        )}
        {tab === "assets" && (
          <div className="assets-page">
            <div className="section-heading">
              <h1>자산</h1>
              <button
                className="text-button"
                disabled={saving}
                onClick={() => setAssetEditor(null)}
              >
                <Plus size={20} /> 추가
              </button>
            </div>
            <p className="section-description">
              전체 기간 · 관리항목 포함 · {currency} 환산
            </p>
            <p className="footnote">
              처음 보유한 금액은 ‘잔액 조정’으로 입력해 주세요. 거래를 수정하면
              다른 자산으로 옮길 수 있어요.
            </p>
            {ledger.assets.map((asset) => {
              const transactions = assetTransactions(
                ledger.transactions,
                asset.id,
              );
              const balance = totals(transactions, currency, asset.id);
              return (
                <section key={asset.id} className="asset-card">
                  <div className="section-heading">
                    <h2>{asset.label}</h2>
                    <button
                      className="text-button"
                      disabled={saving}
                      aria-label={`${asset.label} 관리`}
                      onClick={() => setAssetEditor(asset)}
                    >
                      관리
                    </button>
                  </div>
                  <p className="asset-balance">
                    {balance.missing > 0 &&
                    balance.missing === transactions.length
                      ? "—"
                      : money(balance.balance, currency)}{" "}
                    <small>{currency}</small>
                  </p>
                  {balance.missing > 0 && (
                    <p className="footnote">
                      환산 환율이 없는 {balance.missing}건은 제외했어요.
                    </p>
                  )}
                  <div className="asset-actions">
                    <button
                      className="button button-soft"
                      onClick={() => {
                        setSelectedAsset(asset.id);
                        setQuery("");
                        setSelectedCategories([]);
                        setFilter("all");
                        navigate("transactions");
                      }}
                    >
                      내역 보기
                    </button>
                    <button
                      className="button button-soft"
                      disabled={saving}
                      onClick={() => {
                        setSelectedAsset(asset.id);
                        openEditor("management");
                      }}
                    >
                      잔액 조정
                    </button>
                  </div>
                </section>
              );
            })}
            <p className="footnote">각 거래의 등록 당시 환율로 계산해요.</p>
          </div>
        )}
      </main>
      <nav className="bottom-nav" aria-label="메뉴">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => navigate(id)}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon size={24} strokeWidth={tab === id ? 2.2 : 1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {showBudgetInfo && (
        <Modal title="생활비 잔액 안내" close={() => setShowBudgetInfo(false)}>
          <p className="footnote">
            {!budget ? (
              "선택한 기간의 급여가 없어요. 급여 카테고리로 월급을 등록해 주세요."
            ) : budget.remaining === null ? (
              "환산 환율이 없는 항목이 있어 생활비 잔액을 계산할 수 없어요."
            ) : (
              <>
                {budget.start}부터{" "}
                {budget.nextPayday
                  ? `${budget.nextPayday} 급여 전까지`
                  : "다음 월급일 전까지"}
                {" · "}
                {budgetAsOf} 기준
                <br />
                월급 {money(budget.salary, currency)} − 적금{" "}
                {money(budget.savings, currency)} − 직전 기간 적자{" "}
                {money(budget.previousDeficit, currency)}
                {budget.priorSpending > 0 && (
                  <> − 기록 전 사용액 {money(budget.priorSpending, currency)}</>
                )}
                {" − 생활비 지출 "}
                {money(budget.expense, currency)} {currency}
                <br />
                적금은 매 급여 기간 5,000 DKK를 차감하고, 남은 생활비는
                이월하지 않아요.
              </>
            )}
          </p>
          <p className="footnote">
            {activeAssetId ? "자산 잔액" : "전체 잔액"}은 모든 기간 내역과
            관리항목을 포함해요.
            {overall.missing > 0
              ? ` 환산 환율이 없는 ${overall.missing}건은 제외했어요.`
              : ""}
          </p>
        </Modal>
      )}
      {editor !== undefined && (
        <TransactionEditor
          transaction={editor}
          currencies={ledger.currencies}
          assets={ledger.assets}
          initialAssetId={activeAssetId}
          initialCategory={editorCategory}
          customCategories={ledger.customCategories}
          onAddCategory={addCategory}
          onSave={save}
          close={() => setEditor(undefined)}
        />
      )}
      {assetEditor !== undefined && (
        <AssetEditor
          asset={assetEditor}
          canDelete={
            ledger.assets.length > 1 &&
            !ledger.transactions.some(
              (item) =>
                item.assetId === assetEditor?.id ||
                item.toAssetId === assetEditor?.id,
            )
          }
          onSave={saveAsset}
          remove={async () => {
            await commit({
              ...ledger,
              assets: ledger.assets.filter(
                (asset) => asset.id !== assetEditor?.id,
              ),
            });
            setToast("자산을 삭제했어요");
          }}
          close={() => setAssetEditor(undefined)}
        />
      )}
      {detail && (
        <TransactionDetail
          transaction={detail}
          currency={currency}
          customCategories={ledger.customCategories}
          assets={ledger.assets}
          close={() => setDetail(null)}
          edit={() => {
            setEditor(detail);
            setDetail(null);
          }}
          remove={async () => {
            await commit({
              ...ledger,
              transactions: ledger.transactions.filter(
                (item) => item.id !== detail.id,
              ),
            });
            setDetail(null);
            setToast("삭제했어요");
          }}
        />
      )}
      <div
        className={`toast ${toast ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <>
            <Check size={19} />
            {toast}
          </>
        )}
      </div>
    </div>
  );
}
