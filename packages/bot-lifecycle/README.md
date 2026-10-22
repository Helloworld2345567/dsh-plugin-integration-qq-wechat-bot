# Sakura lifecycle coordinator

This independent Harness bundle drains the bot runtime, installs validated archives through Plugin Manager, checks loaded package identity and recovers once with the previous archive. It deliberately does not inject `botIntegration`, so unloading the mutable bot bundle cannot dispose the coordinator. Install through the product installer and launch through the supervised product launcher. Upgrade requests and recovery phases live in the product home, outside released packages.
