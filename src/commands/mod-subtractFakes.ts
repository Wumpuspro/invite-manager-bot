import { RichEmbed } from 'discord.js';
import {
	Command,
	CommandDecorators,
	Logger,
	logger,
	Message,
	Middleware
} from 'yamdbf';

import { IMClient } from '../client';
import {
	customInvites,
	CustomInvitesGeneratedReason,
	inviteCodes,
	JoinAttributes,
	JoinInstance,
	joins,
	members,
	sequelize
} from '../sequelize';
import { CommandGroup, createEmbed, showPaginated } from '../utils/util';

const { resolve } = Middleware;
const { using } = CommandDecorators;

const usersPerPage = 20;

export default class extends Command<IMClient> {
	@logger('Command') private readonly _logger: Logger;

	public constructor() {
		super({
			name: 'subtract-fakes',
			aliases: ['subtractfakes', 'subfakes', 'sf'],
			desc: 'Remove fake invites from all users',
			usage: '<prefix>subtract-fakes',
			clientPermissions: ['MANAGE_GUILD'],
			group: CommandGroup.Admin,
			guildOnly: true
		});
	}

	public async action(message: Message, [_page]: [number]): Promise<any> {
		this._logger.log(
			`${message.guild.name} (${message.author.username}): ${message.content}`
		);

		const js = await joins.findAll({
			attributes: [
				'memberId',
				[sequelize.fn('COUNT', sequelize.col('exactMatch.code')), 'numJoins'],
				[sequelize.fn('MAX', sequelize.col('join.createdAt')), 'newestJoinAt']
			],
			where: {
				guildId: message.guild.id
			},
			group: [sequelize.col('join.memberId'), sequelize.col('exactMatch.code')],
			include: [
				{
					attributes: ['code', 'inviterId'],
					model: inviteCodes,
					as: 'exactMatch',
					include: [
						{
							attributes: ['name'],
							model: members,
							as: 'inviter'
						}
					]
				}
			],
			raw: true
		});

		if (js.length === 0) {
			await message.channel.send(`There have been no invites so far!`);
			return;
		}

		// Delete old duplicate removals
		await customInvites.destroy({
			where: {
				guildId: message.guild.id,
				reason: {
					[sequelize.Op.like]: CustomInvitesGeneratedReason.fake + ':'
				},
				generated: true
			}
		});

		// Add removals for duplicate invites
		const customInvs = js
			.filter((j: any) => parseInt(j.numJoins, 10) > 1)
			.map((j: any) => ({
				id: null,
				guildId: message.guild.id,
				memberId: j['exactMatch.inviterId'],
				creatorId: null,
				amount: -parseInt(j.numJoins, 10),
				reason: j.memberId,
				generatedReason: CustomInvitesGeneratedReason.fake
			}));
		await customInvites.bulkCreate(customInvs, {
			updateOnDuplicate: ['amount', 'updatedAt']
		});

		const total = -customInvs.reduce((acc, inv) => acc + inv.amount, 0);
		await message.channel.send(`Removed ${total} fake invites!`);
	}
}