/* eslint-disable @next/next/no-img-element */

/** The signed-in student's picture (from Google), else their initial. */
export default function AccountAvatar({
  name,
  email,
  url,
  size = 32,
}: {
  name: string | null;
  email: string | null;
  url: string | null;
  size?: number;
}) {
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();
  return url ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="rounded-full bg-slate-200 object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex items-center justify-center rounded-full bg-brand-600 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  );
}
