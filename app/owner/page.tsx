import type { Metadata } from "next";
import OwnerView from "@/components/OwnerView";

// No title of its own: a tab or a history entry reading "Owner" would say
// what the page is to someone without the code.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** `/owner?code=<DEBUG_CODE>`: see components/OwnerView.tsx. */
export default function OwnerPage() {
  return <OwnerView />;
}
