import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CameraFramingControl } from "./CameraFramingControl";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function control(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(".observer-hud__framing");
  if (found === null) throw new Error("the framing control was not rendered");
  return found;
}

describe("CameraFramingControl", () => {
  it("is PRESENT before it is needed, which is the whole difference from the retired badge", async () => {
    // The badge it replaced only appeared once the viewer had already taken the
    // camera -- i.e. a viewer could not learn where the way back was until they
    // were already lost. This reads the framing at all times.
    await act(async () => root.render(
      <CameraFramingControl mode="story" viewerControlled={false} onResumeStory={vi.fn()} />,
    ));
    expect(control().getAttribute("data-framing")).toBe("story");
    expect(control().textContent).toContain("Story");
    // Nothing to hand back: a control that claimed otherwise would be the same
    // silent lie, in the other direction.
    expect(control().disabled).toBe(true);
  });

  it("lights up and offers the way back the moment the viewer takes the camera", async () => {
    const onResumeStory = vi.fn();
    await act(async () => root.render(
      <CameraFramingControl mode="story" viewerControlled onResumeStory={onResumeStory} />,
    ));

    expect(control().getAttribute("data-framing")).toBe("yours");
    expect(control().disabled).toBe(false);
    expect(control().getAttribute("aria-label"))
      .toBe("Framing: Yours. You are steering the view. Press to resume story framing, or press S.");

    await act(async () => control().click());
    expect(onResumeStory).toHaveBeenCalledOnce();
  });

  it("reads a viewer ZOOM as theirs even though the camera mode never changed", async () => {
    // The exact state the retired badge existed for and the exact state its
    // button could not escape: authority taken, mode untouched.
    await act(async () => root.render(
      <CameraFramingControl mode="story" viewerControlled onResumeStory={vi.fn()} />,
    ));
    expect(control().getAttribute("data-framing")).toBe("yours");
    expect(control().disabled).toBe(false);
  });

  it("offers Follow the same way out, since Follow is not the story either", async () => {
    const onResumeStory = vi.fn();
    await act(async () => root.render(
      <CameraFramingControl mode="follow" viewerControlled={false} onResumeStory={onResumeStory} />,
    ));
    expect(control().getAttribute("data-framing")).toBe("follow");
    expect(control().disabled).toBe(false);
    await act(async () => control().click());
    expect(onResumeStory).toHaveBeenCalledOnce();
  });
});
