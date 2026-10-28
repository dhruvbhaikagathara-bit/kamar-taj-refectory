import type { MealAnalytics } from "@/lib/meal-analytics";

type ConsumptionChartsProps = {
  meals: MealAnalytics[];
};

const numberFormatter = new Intl.NumberFormat("en-IN");

function count(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function mealLabel(value: string) {
  const labels: Record<string, string> = {
    BREAKFAST: "Breakfast",
    LUNCH: "Lunch",
    DINNER: "Dinner",
  };

  return labels[value] ?? value;
}

export function ConsumptionCharts({
  meals,
}: ConsumptionChartsProps) {
  if (meals.length === 0) {
    return null;
  }

  const order = ["BREAKFAST", "LUNCH", "DINNER"];

  const rows = [...meals]
    .sort((a, b) => {
      const aIndex = order.indexOf(a.meal_type);
      const bIndex = order.indexOf(b.meal_type);

      return (
        (aIndex === -1 ? 99 : aIndex) -
        (bIndex === -1 ? 99 : bIndex)
      );
    })
    .map((meal) => ({
      id: meal.id,
      label: mealLabel(meal.meal_type),
      expected: count(meal.expected_count),
      collected: count(meal.collected_count),
    }));

  const largest = Math.max(
    1,
    ...rows.flatMap((row) => [
      row.expected,
      row.collected,
    ])
  );

  // Use one shared scale across all meals.
  const tickStep = Math.max(1, Math.ceil(largest / 4));
  const scaleMaximum = tickStep * 4;

  const width = Math.max(600, rows.length * 180 + 100);
  const height = 340;
  const left = 65;
  const right = 25;
  const top = 45;
  const bottom = 65;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const baseline = height - bottom;
  const groupWidth = plotWidth / rows.length;
  const barWidth = Math.min(46, groupWidth * 0.25);

  const dietaryRows = [
    {
      label: "Vegetarian",
      value: meals.reduce(
        (sum, meal) => sum + count(meal.vegetarian_count),
        0
      ),
      color: "bg-emerald-600",
    },
    {
      label: "Non-vegetarian",
      value: meals.reduce(
        (sum, meal) =>
          sum + count(meal.nonvegetarian_count),
        0
      ),
      color: "bg-orange-500",
    },
    {
      label: "Vegan",
      value: meals.reduce(
        (sum, meal) => sum + count(meal.vegan_count),
        0
      ),
      color: "bg-teal-500",
    },
    {
      label: "Jain",
      value: meals.reduce(
        (sum, meal) => sum + count(meal.jain_count),
        0
      ),
      color: "bg-violet-500",
    },
    {
      label: "Not specified",
      value: meals.reduce(
        (sum, meal) =>
          sum + count(meal.unspecified_count),
        0
      ),
      color: "bg-slate-500",
    },
  ];

  const dietaryTotal = dietaryRows.reduce(
    (sum, row) => sum + row.value,
    0
  );

  const dietaryMaximum = Math.max(
    1,
    ...dietaryRows.map((row) => row.value)
  );

  return (
    <section
      aria-label="Consumption charts"
      className="space-y-6"
    >
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-bold text-[#103C39]">
          Expected versus collected meals
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Compare meal commitments with recorded QR
          collections for the selected date.
        </p>

        <div className="mt-5 flex flex-wrap gap-5 text-sm text-slate-700">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-sm bg-[#087A68]"
            />
            Expected
          </span>

          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-sm bg-[#EA8A23]"
            />
            Collected
          </span>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-label="Meal comparison chart; scroll horizontally on small screens"
          className="mt-4 overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Grouped bar chart of expected and collected meals. Exact values are provided in the table below."
            className="block w-full min-w-[600px]"
          >
            <text
              x={left}
              y={20}
              fontSize="12"
              fill="#475569"
            >
              Meal portions
            </text>

            {Array.from({ length: 5 }, (_, index) => {
              const value = index * tickStep;
              const y =
                baseline -
                (value / scaleMaximum) * plotHeight;

              return (
                <g key={value}>
                  <line
                    x1={left}
                    x2={width - right}
                    y1={y}
                    y2={y}
                    stroke="#E2E8F0"
                    strokeDasharray={
                      index === 0 ? undefined : "4 4"
                    }
                  />

                  <text
                    x={left - 12}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="12"
                    fill="#475569"
                  >
                    {numberFormatter.format(value)}
                  </text>
                </g>
              );
            })}

            {rows.map((row, index) => {
              const center =
                left + groupWidth * (index + 0.5);

              const bars = [
                {
                  label: "Expected",
                  value: row.expected,
                  x: center - barWidth - 5,
                  color: "#087A68",
                },
                {
                  label: "Collected",
                  value: row.collected,
                  x: center + 5,
                  color: "#EA8A23",
                },
              ];

              return (
                <g key={row.id}>
                  {bars.map((bar) => {
                    const barHeight =
                      (bar.value / scaleMaximum) *
                      plotHeight;

                    const y = baseline - barHeight;

                    return (
                      <g key={bar.label}>
                        <rect
                          x={bar.x}
                          y={y}
                          width={barWidth}
                          height={barHeight}
                          rx={4}
                          fill={bar.color}
                        >
                          <title>
                                {`${row.label}: ${bar.label} ${numberFormatter.format(bar.value)}`}
                          </title>
                        </rect>

                        <text
                          x={bar.x + barWidth / 2}
                          y={y - 9}
                          textAnchor="middle"
                          fontSize="13"
                          fontWeight="600"
                          fill="#152D33"
                        >
                          {numberFormatter.format(bar.value)}
                        </text>
                      </g>
                    );
                  })}

                  <text
                    x={center}
                    y={baseline + 28}
                    textAnchor="middle"
                    fontSize="13"
                    fontWeight="600"
                    fill="#334155"
                  >
                    {row.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <details className="mt-3 rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[#087A68]">
            View exact chart values
          </summary>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Expected and collected meal portions
              </caption>

              <thead>
                <tr className="border-b text-slate-600">
                  <th scope="col" className="p-2">
                    Meal
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Expected
                  </th>
                  <th scope="col" className="p-2 text-right">
                    Collected
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b">
                    <th
                      scope="row"
                      className="p-2 font-medium"
                    >
                      {row.label}
                    </th>
                    <td className="p-2 text-right">
                      {numberFormatter.format(row.expected)}
                    </td>
                    <td className="p-2 text-right">
                      {numberFormatter.format(row.collected)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <p className="mt-4 text-xs leading-5 text-slate-500">
          Collections measure meals collected, not food
          actually eaten. Expected counts reflect current
          eligible enrollments and may change. A gap between
          the bars is not a measurement of food waste.
        </p>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-bold text-[#103C39]">
          Expected portions by dietary preference
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Each opted-in meal contributes one portion.
          A student may contribute multiple portions.
        </p>

        {dietaryTotal === 0 ? (
          <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
            No expected dietary portions for this date.
          </p>
        ) : (
          <ul className="mt-6 space-y-5">
            {dietaryRows.map((row) => {
              const share =
                (row.value / dietaryTotal) * 100;

              return (
                <li key={row.label}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-700">
                      {row.label}
                    </span>

                    <span className="text-right font-semibold text-[#103C39]">
                      {numberFormatter.format(row.value)}
                      <span className="ml-2 font-normal text-slate-500">
                        ({share.toFixed(1)}%)
                      </span>
                    </span>
                  </div>

                  <div
                    aria-hidden="true"
                    className="h-5 overflow-hidden rounded-md bg-slate-100"
                  >
                    <div
                      className={`h-full rounded-md ${row.color}`}
                      style={{
                        width: `${
                          (row.value / dietaryMaximum) * 100
                        }%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}