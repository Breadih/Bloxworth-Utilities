const { SlashCommandBuilder, MessageFlags, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('host-shift')
        .setDescription('Hosts a shift.'),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const shifts = await this.fetchAndFilterShifts();
            if (!shifts.length) {
                return interaction.editReply({ content: 'No shifts with due dates found.', ephemeral: true });
            }

            const { embed, select } = this.createShiftSelectionComponents(shifts);
            const reply = await interaction.editReply({ embeds: [embed], components: [{ type: 1, components: [select] }], ephemeral: true });

            await this.handleShiftSelection(interaction, reply, shifts);
        } catch (error) {
            console.error('Error in host-shift command:', error);
            await interaction.editReply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
    },

    async fetchAndFilterShifts() {
        const response = await fetch('https://api.trello.com/1/lists/67bf40722413f163023fdf29/cards?key=9c75cc93b68673a3cc91fc2c8f7608cc&token=ATTAa482205ecb06bfd0245d074076ae141292c13ae2620acdcec419c5957d8618e6356DF5A9', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        const ajson = await response.json();
        return ajson.slice(0, 12).filter(card => card.due);
    },

    createShiftSelectionComponents(shifts) {
        const select = new StringSelectMenuBuilder()
            .setCustomId('shift_select')
            .setPlaceholder('Select a shift!');

        const embed = new EmbedBuilder()
            .setTitle('Upcoming Shifts')
            .setDescription('Here are the upcoming shifts!')
            .setColor('#0099ff');

        shifts.forEach(card => {
            const formattedDate = new Date(card.due).toLocaleString();
            embed.addFields({ name: card.name, value: formattedDate });
            select.addOptions(new StringSelectMenuOptionBuilder().setLabel(card.name).setDescription(formattedDate).setValue(card.id));
        });

        return { embed, select };
    },

    async handleShiftSelection(interaction, reply, shifts) {
        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: i => i.user.id === interaction.user.id,
            time: 120_000,
        });

        collector.on('collect', async (i) => {
            await i.deferUpdate();
            const selectedShift = shifts.find(shift => shift.id === i.values[0]);

            if (!selectedShift) {
                return interaction.editReply({ content: "Invalid shift selection.", components: [] });
            }

            const { shiftDetails, description } = await this.createShiftDetails(selectedShift);
            const buttonRow = this.createConfirmationButtons();

            await interaction.editReply({ embeds: [shiftDetails], components: [buttonRow] });
            await this.handleConfirmationButtons(interaction, reply, description); // Pass description
        });

        collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
    },

    async createShiftDetails(selectedShift) {
        let getMemberJSON = { username: 'Unknown' };

        if (selectedShift.idMembers && selectedShift.idMembers.length > 0) {
            try {
                const getMember = await fetch(`https://api.trello.com/1/members/${selectedShift.idMembers[0]}?key=9c75cc93b68673a3cc91fc2c8f7608cc&token=ATTAa482205ecb06bfd0245d074076ae141292c13ae2620acdcec419c5957d8618e6356DF5A9`, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                });

                if (getMember.ok) {
                    getMemberJSON = await getMember.json();
                } else {
                    console.error(`Failed to fetch member: ${getMember.status} ${getMember.statusText}`);
                }
            } catch (error) {
                console.error('Error fetching Trello member:', error);
            }
        }

        const StartDate = Math.floor(new Date(selectedShift.due).getTime() / 1000);
        const FinishDate = StartDate ? StartDate + 3600 : null;

        let description = `**Shift Name:** ${selectedShift.name}\n` +
            `**Host:** ${getMemberJSON.username}\n`;

        if (StartDate && FinishDate) {
            description += `**Start:** <t:${StartDate}:R>\n**Finish:** <t:${FinishDate}:R>`;
        } else {
            description += `**Start/Finish:** Time data unavailable`;
        }

        return { shiftDetails: new EmbedBuilder()
            .setTitle(`Selected Shift: ${selectedShift.name}`)
            .setDescription(`**Do you wish to announce the following shift?**\n\n` + description)
            .setColor("#0099ff"), description: description };
    },

    createConfirmationButtons() {
        const acceptButton = new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel('Accept').setCustomId('acceptshift');
        const refuseButton = new ButtonBuilder().setStyle(ButtonStyle.Danger).setLabel('Refuse').setCustomId('refuseshift');
        return new ActionRowBuilder().addComponents(acceptButton, refuseButton);
    },

    async handleConfirmationButtons(interaction, reply, description) { // Added description
        const buttonCollector = reply.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: b => b.user.id === interaction.user.id,
            time: 120_000,
        });

        buttonCollector.on('collect', async (b) => {
            await b.deferUpdate();

            if (b.customId === 'acceptshift') {
                const ShiftAccepted = new EmbedBuilder()
                .setColor('#33ff5b')
                .setDescription('The shift has been announced successfully!\nPlease see the shift\'s channel for more information!')
                await interaction.editReply({ content: '', embeds: [], components: [] });
                try {
                    const shifts = await interaction.guild.channels.fetch('1332446090183577721');
                    const ShiftEMBED = new EmbedBuilder()
                        .setColor("#7785cc")
                        .setDescription(`The following shift will be hosted, more information is below:\n\n` + description);
                    await shifts.send({
                        content: '@everyone',
                        embeds: [ShiftEMBED]
                    });
                } catch (error) {
                    console.error("Error sending shift announcement:", error);
                    await interaction.editReply({ content: "Failed to send shift announcement.", embeds: [], components: [] });
                }
            } else if (b.customId === 'refuseshift') {
                await interaction.editReply({ content: 'Shift refused.', embeds: [], components: [] });
            }

            buttonCollector.stop();
        });
    },
};