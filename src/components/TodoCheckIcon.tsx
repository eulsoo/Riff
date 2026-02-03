import { ComponentProps } from 'react';

/**
 * A reusable TodoCheckIcon component to optimize rendering performance.
 * This prevents the large SVG path from being duplicated in the DOM for every todo item.
 */
export function TodoCheckIcon(props: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M6.76296 20.8119C6.8875 20.9254 7.09687 20.9342 7.22182 20.832C7.27072 20.7922 7.4851 20.458 7.69865 20.0894C8.96324 17.9062 10.6261 15.481 12.2075 13.5132C15.0342 9.99593 18.0034 7.13381 21.2798 4.76847C22.1202 4.16195 22.1825 4.02582 21.6212 4.02582C20.8786 4.02582 19.0118 4.73496 17.5274 5.58065C14.7011 7.19162 11.9475 9.66964 7.65269 14.4686L7.50976 14.6278L7.28033 14.0933C6.7546 12.8685 6.11144 12.0304 5.37007 11.6052C4.46907 11.0883 3.03354 11.4913 2.85929 11.8733C2.68503 12.2553 2.85929 12.3919 3.03354 12.6222C3.20779 12.8526 3.61861 13.46 3.61861 13.46C4.04195 13.9789 4.98936 16.1717 5.83938 18.5186C6.43072 20.1518 6.65807 20.7164 6.76296 20.8119Z"
        fill="currentColor"
      />
    </svg>
  );
}
