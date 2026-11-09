import Image from "next/image";

/**
 * The MatchBase logo inside the 32px rounded badge every header draws around
 * it: 24px, the smallest size at which the mark's six cells stay distinct.
 * The logo is pale (it was drawn for dark backgrounds), so the badge is
 * `bg-primary` (near-black) in light mode and `dark:bg-secondary` in dark mode,
 * where `bg-primary` turns near-white and the logo would disappear.
 * Decorative (empty alt): the wordmark next to it already names the link.
 */
export function BrandMark() {
  return (
    <Image
      src="/brand/matchbase.png"
      alt=""
      width={24}
      height={24}
      loading="eager"
      className="size-6 object-contain"
    />
  );
}
