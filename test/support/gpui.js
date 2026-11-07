// The UI toolkit isn't exercised by the tests; these only let modules that build UI be imported.
const element = () => new Proxy({}, { get: () => element });
export const div = element, svg = element, image = element, h_flex = element, v_flex = element, Input = element, Textarea = element;
