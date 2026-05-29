import Root from "$lib/components/ui/alert/alert.svelte";
import Description from "$lib/components/ui/alert/alert-description.svelte";
import Title from "$lib/components/ui/alert/alert-title.svelte";
import Action from "$lib/components/ui/alert/alert-action.svelte";
export { alertVariants, type AlertVariant } from "$lib/components/ui/alert/alert.svelte";

export {
	Root,
	Description,
	Title,
	Action,
	//
	Root as Alert,
	Description as AlertDescription,
	Title as AlertTitle,
	Action as AlertAction,
};
