// A page fills the whole area under the top bar (Sessions, Settings, Set up a console): the clean-table manner of the
// plan's list pages, no split areas and no timeline.
export interface Page { el: HTMLElement; frame(force: boolean): void; destroy?(): void }
