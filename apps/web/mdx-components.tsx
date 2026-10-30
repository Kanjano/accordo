import type { MDXComponents } from 'mdx/types';

const components: MDXComponents = {
  h1: (props) => <h1 className="text-3xl font-bold tracking-tight" {...props} />,
  h2: (props) => <h2 className="mt-8 text-xl font-semibold" {...props} />,
  p: (props) => <p className="mt-4 leading-7" {...props} />,
  ul: (props) => <ul className="mt-4 list-disc space-y-1 pl-6" {...props} />,
  a: (props) => <a className="text-primary underline underline-offset-4" {...props} />,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
