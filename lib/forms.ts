import { startTransition, type FormEvent } from "react";

/**
 * An onSubmit handler that runs a `useActionState` action. Unlike
 * `<form action>`, React does not reset the form afterwards, so what the
 * user typed survives a server-side error.
 */
export function submitKeepingValues(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
}
