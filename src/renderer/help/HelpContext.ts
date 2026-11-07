import { createContext, useContext } from 'react';

/** Opens the Help tab at an article (used by the "?" links on complex screens). */
export const HelpContext = createContext<(articleId: string) => void>(() => {});
export const useOpenHelp = () => useContext(HelpContext);
