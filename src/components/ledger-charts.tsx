"use client";

import { useId, useState } from "react";
import {
  categoryInfo,
  fractionDigits,
  money,
  totals,
  type CustomCategory,
  type Transaction,
} from "@/lib/ledger";
import {
  cashflowTrend,
  categoryBreakdown,
  type PeriodMode,
} from "@/lib/ledger-analytics";

const series = [
  { key: "income", label: "수입", color: "#3182f6" },
  { key: "expense", label: "지출", color: "#e5484d" },
] as const;

export default function LedgerCharts({
  transactions,
  currency,
  customCategories,
  month,
  mode,
  breakdownType,
}: {
  transactions: Transaction[];
  currency: string;
  customCategories: CustomCategory[];
  month: string;
  mode: PeriodMode;
  breakdownType: Transaction["type"];
}) {
  const chartId = useId();
  const [activeKey, setActiveKey] = useState("");
  const { points, missing } = cashflowTrend(
    transactions,
    currency,
    month,
    mode,
  );
  const breakdown = categoryBreakdown(transactions, currency, breakdownType);
  const total = totals(transactions, currency);
  const active = points.find((point) => point.key === activeKey);
  const amounts = active ?? total;
  const max = Math.max(
    1,
    ...points.map((point) => Math.max(point.income, point.expense)),
  );
  const x = (index: number) => 46 + (index / (points.length - 1)) * 260;
  const y = (amount: number) => 150 - (amount / max) * 130;
  const compactMoney = (amount: number) =>
    new Intl.NumberFormat("ko-KR", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount / 10 ** fractionDigits(currency));
  const tickIndices = new Set(
    Array.from({ length: 5 }, (_, index) =>
      Math.round((index * (points.length - 1)) / 4),
    ),
  );
  let offset = 0;
  const segments = breakdown.items.map((item) => {
    const start = offset;
    offset += item.percent;
    return `${categoryInfo(item.category, customCategories).color} ${start}% ${offset}%`;
  });
  const typeLabel = breakdownType === "income" ? "수입" : "지출";
  return (
    <div className="ledger-charts">
      <section className="chart-section" aria-labelledby={`${chartId}-trend`}>
        <h2 id={`${chartId}-trend`}>수입·지출 흐름</h2>
        <div className="trend-toolbar">
          <span>
            {mode === "year" ? "월별 금액" : "일별 금액"} · {currency}
          </span>
          <select
            aria-label="그래프 상세 기간"
            value={active?.key ?? ""}
            onChange={(event) => setActiveKey(event.target.value)}
          >
            <option value="">기간 합계</option>
            {points.map((point) => (
              <option key={point.key} value={point.key}>
                {point.label}
              </option>
            ))}
          </select>
        </div>
        <div className="trend-totals" aria-live="polite">
          {series.map((item) => (
            <div key={item.key}>
              <span>
                <i style={{ background: item.color }} />
                {item.label}
              </span>
              <strong>
                {money(amounts[item.key], currency)} <small>{currency}</small>
              </strong>
            </div>
          ))}
        </div>
        {total.income || total.expense ? (
          <svg
            className="trend-chart"
            viewBox="0 0 320 180"
            role="img"
            aria-labelledby={`${chartId}-title ${chartId}-desc`}
          >
            <title id={`${chartId}-title`}>
              {month.slice(0, mode === "year" ? 4 : 7)} 수입·지출{" "}
              {mode === "year" ? "월별" : "일별"} 그래프
            </title>
            <desc id={`${chartId}-desc`}>
              파란 선은 수입, 빨간 선은 지출입니다. 그래프 상세 기간 선택에서 각
              기간의 정확한 금액을 확인할 수 있습니다.
            </desc>
            {[0, 0.5, 1].map((ratio) => (
              <g key={ratio}>
                <line
                  x1="46"
                  x2="306"
                  y1={y(max * ratio)}
                  y2={y(max * ratio)}
                  stroke="#eef0f3"
                />
                <text x="39" y={y(max * ratio) + 4} textAnchor="end">
                  {compactMoney(max * ratio)}
                </text>
              </g>
            ))}
            {points.map(
              (point, index) =>
                tickIndices.has(index) && (
                  <text
                    key={point.key}
                    x={x(index)}
                    y="174"
                    textAnchor="middle"
                  >
                    {point.label}
                  </text>
                ),
            )}
            {active && (
              <line
                x1={x(points.indexOf(active))}
                x2={x(points.indexOf(active))}
                y1="14"
                y2="150"
                stroke="#b0b8c1"
                strokeDasharray="3 3"
              />
            )}
            {series.map((item) => (
              <g key={item.key}>
                <polyline
                  points={points
                    .map((point, index) => `${x(index)},${y(point[item.key])}`)
                    .join(" ")}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {active && (
                  <circle
                    cx={x(points.indexOf(active))}
                    cy={y(active[item.key])}
                    r="4"
                    fill={item.color}
                    stroke="#fff"
                    strokeWidth="2"
                  />
                )}
              </g>
            ))}
            {points.map((point, index) => (
              <rect
                key={point.key}
                x={x(index) - 130 / (points.length - 1)}
                y="10"
                width={260 / (points.length - 1)}
                height="150"
                fill="transparent"
                aria-hidden="true"
                onClick={() => setActiveKey(point.key)}
              />
            ))}
          </svg>
        ) : (
          <p className="chart-empty">이 기간에 환산 가능한 내역이 없어요.</p>
        )}
        <p className="footnote">
          검색·카테고리 조건에 맞는 수입과 지출이에요. 그래프를 누르면 금액을 볼
          수 있어요.
        </p>
        {missing > 0 && (
          <p className="chart-warning">
            환산 환율이 없는 {missing}건은 그래프에서 제외했어요.
          </p>
        )}
      </section>
      <section
        className="chart-section"
        aria-labelledby={`${chartId}-categories`}
      >
        <h2 id={`${chartId}-categories`}>카테고리별 {typeLabel}</h2>
        <p className="section-description">
          선택한 카테고리의 {typeLabel} 합계를 기준으로 계산해요.
        </p>
        {breakdown.total > 0 ? (
          <>
            <div
              className="donut-chart"
              style={{ background: `conic-gradient(${segments.join(",")})` }}
              role="img"
              aria-label={breakdown.items
                .map(
                  (item) =>
                    `${categoryInfo(item.category, customCategories).label} ${item.percent.toFixed(1)}%`,
                )
                .join(", ")}
            >
              <div className="donut-center">
                <span>총 {typeLabel}</span>
                <strong>{money(breakdown.total, currency)}</strong>
                <small>{currency}</small>
              </div>
            </div>
            <ul className="chart-breakdown">
              {breakdown.items.map((item) => {
                const category = categoryInfo(item.category, customCategories);
                return (
                  <li key={item.category}>
                    <span className="breakdown-label">
                      <i style={{ background: category.color }} />
                      {category.label}
                    </span>
                    <span className="breakdown-value">
                      <strong>
                        {item.percent < 0.1
                          ? "0.1% 미만"
                          : `${item.percent.toFixed(1)}%`}
                      </strong>
                      <span>
                        {money(item.amount, currency)} {currency}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="chart-empty">
            선택한 조건의 {typeLabel} 내역이 없어요.
          </p>
        )}
      </section>
    </div>
  );
}
