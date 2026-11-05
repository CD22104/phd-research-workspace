<script setup>
import { useDialog, useMessage, useNotification } from 'naive-ui';
import { ui } from '../lib/ui';
ui.message = useMessage();
ui.dialog = useDialog();
ui.notification = useNotification();
</script>
<template><span style="display: none" /></template>
