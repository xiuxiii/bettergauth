import { Suspense } from "react";
import TutorWorkspace from "@/components/TutorWorkspace";

export default function WorkspacePage() {
  // TutorWorkspace reads ?session= to reopen a saved problem, and
  // useSearchParams() opts a page out of static prerendering unless it sits
  // behind a Suspense boundary. The fallback is null rather than a skeleton:
  // the component paints its own loading state a moment later, and two
  // different loaders flashing in sequence reads worse than one.
  return (
    <Suspense fallback={null}>
      <TutorWorkspace />
    </Suspense>
  );
}
